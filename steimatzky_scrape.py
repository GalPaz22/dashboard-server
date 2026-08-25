#!/usr/bin/env python3
"""
Fetch all products from steimatzky.co.il (Magento).

The site's REST/GraphQL APIs sit behind Cloudflare and return 403, but the XML
sitemaps and product pages are served normally. So we:

  1. Read the sitemap index -> the two product sitemaps (book / not_book).
  2. Collect every product URL (plus the title/image the sitemap already gives us).
  3. Fetch each product page and parse its JSON-LD (<script type="application/ld+json">),
     which carries sku, name, description, price, currency, availability, author, publisher.

Output is newline-delimited JSON (one product per line) so a run of ~14k products can
be streamed and resumed. Re-running skips URLs already present in the output file.

Usage:
    python3 steimatzky_scrape.py                    # full crawl -> steimatzky_products.ndjson
    python3 steimatzky_scrape.py --limit 50         # quick test
    python3 steimatzky_scrape.py --workers 8        # tune concurrency
    python3 steimatzky_scrape.py --out books.ndjson --only book
"""

import argparse
import gzip
import json
import os
import re
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE = "https://www.steimatzky.co.il"
SITEMAP_INDEX = f"{BASE}/sitemap.xml"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")

LDJSON_RE = re.compile(
    r'<script type="application/ld\+json">(.*?)</script>', re.S)
LOC_RE = re.compile(r"<loc>(.*?)</loc>", re.S)
# Match each <url>...</url> block so we can grab the sitemap's own title/image too.
URLBLOCK_RE = re.compile(r"<url>(.*?)</url>", re.S)
IMG_RE = re.compile(r"<image:loc>(.*?)</image:loc>", re.S)
TITLE_RE = re.compile(r"<image:title>(.*?)</image:title>", re.S)


def fetch(url, tries=3, timeout=30):
    """GET a URL with retries; returns decoded text (handles gzip)."""
    last = None
    for attempt in range(tries):
        try:
            req = Request(url, headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "he,en;q=0.8",
                "Accept-Encoding": "gzip",
            })
            with urlopen(req, timeout=timeout) as r:
                data = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                return data.decode("utf-8", errors="replace")
        except (HTTPError, URLError, TimeoutError) as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise last


def get_product_sitemaps(only=None):
    """Return the product sitemap URLs from the sitemap index."""
    xml = fetch(SITEMAP_INDEX)
    maps = [u for u in LOC_RE.findall(xml) if "product" in u and "sitemap" in u]
    if only == "book":
        maps = [m for m in maps if "not_book" not in m and "book" in m]
    elif only == "not_book":
        maps = [m for m in maps if "not_book" in m]
    return maps


def get_product_entries(only=None):
    """Return list of dicts {url, sitemap_title, sitemap_image} for every product."""
    entries = []
    seen = set()
    for sm in get_product_sitemaps(only):
        xml = fetch(sm)
        for block in URLBLOCK_RE.findall(xml):
            loc = LOC_RE.search(block)
            if not loc:
                continue
            url = loc.group(1).strip()
            if url in seen:
                continue
            seen.add(url)
            img = IMG_RE.search(block)
            title = TITLE_RE.search(block)
            entries.append({
                "url": url,
                "sitemap_title": title.group(1).strip() if title else None,
                "sitemap_image": img.group(1).strip() if img else None,
            })
    return entries


def parse_product(html, entry):
    """Extract product fields from a page's JSON-LD, falling back to sitemap data."""
    product = None
    for raw in LDJSON_RE.findall(html):
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue
        t = str(d.get("@type", "")).lower()
        if t in ("product", "book") or "offers" in d:
            product = d
            break
    if not product:
        # No structured data; still record what the sitemap gave us.
        return {
            "url": entry["url"],
            "name": entry.get("sitemap_title"),
            "image": entry.get("sitemap_image"),
            "sku": entry["url"].rstrip("/").split("/")[-1],
            "found_ldjson": False,
        }

    offers = product.get("offers") or {}
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    return {
        "url": product.get("url") or entry["url"],
        "sku": product.get("sku"),
        "name": product.get("name") or entry.get("sitemap_title"),
        "type": product.get("@type"),
        "description": product.get("description"),
        "image": product.get("image") or entry.get("sitemap_image"),
        "author": product.get("author"),
        "publisher": product.get("publisher"),
        "price": offers.get("price"),
        "currency": offers.get("priceCurrency"),
        "availability": offers.get("availability"),
        "found_ldjson": True,
    }


def load_done(path):
    """URLs already written, so re-runs resume instead of refetching."""
    done = set()
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["url"])
                except Exception:
                    pass
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="steimatzky_products.ndjson")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0, help="max products (0 = all)")
    ap.add_argument("--only", choices=["book", "not_book"], default=None)
    args = ap.parse_args()

    print("Reading sitemaps...", file=sys.stderr)
    entries = get_product_entries(args.only)
    print(f"Found {len(entries)} product URLs.", file=sys.stderr)

    done = load_done(args.out)
    todo = [e for e in entries if e["url"] not in done]
    if args.limit:
        todo = todo[:args.limit]
    print(f"{len(done)} already scraped; {len(todo)} to fetch.", file=sys.stderr)

    lock = threading.Lock()
    counter = {"ok": 0, "err": 0}

    def work(entry):
        try:
            html = fetch(entry["url"])
            return parse_product(html, entry)
        except Exception as e:
            return {"url": entry["url"], "error": str(e), "found_ldjson": False}

    with open(args.out, "a", encoding="utf-8") as out, \
            ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(work, e): e for e in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            rec = fut.result()
            with lock:
                out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                out.flush()
                if rec.get("error"):
                    counter["err"] += 1
                else:
                    counter["ok"] += 1
            if i % 100 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)}  ok={counter['ok']} err={counter['err']}",
                      file=sys.stderr)

    print(f"Done. Wrote to {args.out} "
          f"(ok={counter['ok']}, err={counter['err']}).", file=sys.stderr)


if __name__ == "__main__":
    main()
