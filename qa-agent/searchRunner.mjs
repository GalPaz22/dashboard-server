// Runs queries through the LIVE search endpoint exactly as the storefront does,
// so the QA verdict reflects real production behavior (auth, ranking, caching).
import { config } from "./config.mjs";

export async function healthCheck() {
  // Any HTTP response means the server is reachable. /health returns 503 when
  // Redis is disconnected (common in dev) but search still works fine, so we
  // treat reachability — not full health — as the gate.
  try {
    const res = await fetch(`${config.baseUrl}/health`, { method: "GET" });
    return typeof res.status === "number";
  } catch {
    return false;
  }
}

function pickName(p) {
  return p.name || p.Name || p.title || p.product_name || "";
}

function normalizeProduct(p) {
  return {
    id: p.id ?? p.ItemID ?? p._id ?? null,
    name: pickName(p),
    category: p.category ?? p.Category ?? null,
    type: p.type ?? null,
    softCategory: p.softCategory ?? null,
    price: p.price ?? p.Price ?? null,
    description: typeof (p.description || p.Description) === "string"
      ? String(p.description || p.Description).slice(0, 220)
      : null,
  };
}

async function withTimeout(promise, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(t);
  }
}

/** Runs a single query against /search for a store. Returns normalized topK. */
export async function runSearch(store, query) {
  let lastErr = null;
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    try {
      const data = await withTimeout(
        (signal) =>
          fetch(`${config.baseUrl}/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": store.apiKey },
            body: JSON.stringify({ query, modern: true }),
            signal,
          }).then(async (r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          }),
        config.requestTimeoutMs
      );

      const products = Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : [];
      return {
        ok: true,
        query,
        searchMode: data?.metadata?.searchMode || null,
        products: products.slice(0, config.topK).map(normalizeProduct),
        count: products.length,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  return { ok: false, query, error: String(lastErr?.message || lastErr), products: [], count: 0 };
}

/** Runs an array of test cases with bounded concurrency. */
export async function runSearchBatch(store, cases) {
  const results = new Array(cases.length);
  let cursor = 0;
  async function worker() {
    while (cursor < cases.length) {
      const i = cursor++;
      const res = await runSearch(store, cases[i].query);
      results[i] = { ...cases[i], result: res };
    }
  }
  const workers = Array.from({ length: Math.min(config.concurrency, cases.length) }, worker);
  await Promise.all(workers);
  return results;
}
