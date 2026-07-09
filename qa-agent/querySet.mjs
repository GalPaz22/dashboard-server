// Builds the per-store set of queries to QA-test, from three real signals:
//   1. recent searches   (queries collection, newest first)
//   2. frequent searches  (queries collection, grouped by text)
//   3. popular products   (product_clicks, grouped by product — searched by name)
// Everything is derived from the store's own data; no query lists are hardcoded.
import { getClient } from "./db.mjs";
import { config } from "./config.mjs";

const normalize = (s) => String(s || "").trim().replace(/\s+/g, " ");

async function recentSearches(db, limit) {
  const docs = await db
    .collection("queries")
    .find({ query: { $exists: true, $ne: "" } })
    .sort({ _id: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => ({
    query: normalize(d.query),
    source: "recent",
    historicalDelivered: Array.isArray(d.deliveredProducts) ? d.deliveredProducts.slice(0, 10) : [],
  }));
}

async function frequentSearches(db, limit) {
  const rows = await db
    .collection("queries")
    .aggregate([
      { $match: { query: { $exists: true, $ne: "" } } },
      // group case-insensitively on trimmed text
      { $group: { _id: { $toLower: { $trim: { input: "$query" } } }, count: { $sum: 1 }, sample: { $first: "$query" } } },
      { $match: { count: { $gte: 2 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ])
    .toArray();
  return rows.map((r) => ({ query: normalize(r.sample), source: "frequent", frequency: r.count }));
}

async function popularProducts(db, limit) {
  // Primary signal: product_clicks grouped by product_name.
  let rows = await db
    .collection("product_clicks")
    .aggregate([
      { $match: { product_name: { $exists: true, $nin: [null, ""] } } },
      { $group: { _id: "$product_name", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ])
    .toArray()
    .catch(() => []);

  // Fallback: checkout_events, then top products by DisplayOrder.
  if (!rows.length) {
    rows = await db
      .collection("checkout_events")
      .aggregate([
        { $unwind: { path: "$products", preserveNullAndEmptyArrays: false } },
        { $group: { _id: { $ifNull: ["$products.name", "$products.product_name"] }, count: { $sum: 1 } } },
        { $match: { _id: { $nin: [null, ""] } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ])
      .toArray()
      .catch(() => []);
  }

  let items = rows
    .filter((r) => r._id)
    .map((r) => ({ query: normalize(r._id), source: "popular_product", clicks: r.count }));

  if (!items.length) {
    const prods = await db
      .collection("products")
      .find({ $or: [{ name: { $exists: true } }, { Name: { $exists: true } }] })
      .sort({ DisplayOrder: 1 })
      .limit(limit)
      .project({ name: 1, Name: 1 })
      .toArray()
      .catch(() => []);
    items = prods
      .map((p) => ({ query: normalize(p.name || p.Name), source: "popular_product" }))
      .filter((p) => p.query);
  }
  return items;
}

/**
 * Returns a deduped, capped list of test cases for a store.
 * Recent/frequent take priority; popular products fill remaining budget.
 */
export async function buildQuerySet(store, overrides = {}) {
  const client = await getClient();
  const db = client.db(store.dbName);
  const cfg = { ...config.querySet, ...overrides };

  const [recent, frequent, popular] = await Promise.all([
    recentSearches(db, cfg.recent).catch(() => []),
    frequentSearches(db, cfg.frequent).catch(() => []),
    popularProducts(db, cfg.popular).catch(() => []),
  ]);

  const seen = new Set();
  const out = [];
  for (const item of [...recent, ...frequent, ...popular]) {
    const key = item.query.toLowerCase();
    if (!item.query || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= cfg.cap) break;
  }
  return out;
}
