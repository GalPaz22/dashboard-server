/* =========================================================================== *\
   KNOWN NON-CONVERTING QUERIES — the concierge's `known_weak` trigger
   ---------------------------------------------------------------------------
   Some searches come back with products, look fine, and still never sell:
   shoppers run them again and again and leave without clicking or adding to
   the cart. The store's own logs already say which ones: `queries` (who
   searched what), `product_clicks` and `cart` (what came of it, by
   search_query). This module turns the last 30 days of those into a list per
   store, refreshed in the background, and matches each new search against it
   — by normalized wording first, then by meaning (query embeddings, cosine).

   A merchant (or the Tenant Studio) can also pin queries by hand in the
   store database's `concierge_weak_queries` collection:
     { query: "...", note?: "what the shopper should know", enabled?: false }
   A pinned query is always on the list; its note is handed to the opening
   turn so the concierge explains the right thing.

   Opt-in per store: `conciergeWeakQueries: true` on the users doc (next to
   `concierge: true`). Off by default, so no running store changes behaviour.
\* =========================================================================== */

const WINDOW_DAYS = Number(process.env.CONCIERGE_WEAK_DAYS) || 30;
const MIN_SESSIONS = Number(process.env.CONCIERGE_WEAK_MIN_SESSIONS) || 3;
// Share of searching sessions that clicked any result. Below this, and with
// no add-to-cart at all, the query counts as non-converting.
const MAX_CLICK_RATE = Number(process.env.CONCIERGE_WEAK_MAX_CLICK_RATE) || 0.2;
const MAX_LIST = 300;
const MAX_EMBEDDED = 150;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const SEMANTIC_THRESHOLD = Number(process.env.CONCIERGE_WEAK_SEMANTIC_THRESHOLD) || 0.88;
const SEMANTIC_TIMEOUT_MS = 2500;

/* ------------------------------ matching ---------------------------------- */

const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

export function normalizeQuery(q) {
  return String(q || "").toLowerCase()
    .replace(/[֑-ׇ]/g, "")
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/["'`׳״]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Hebrew glues ו/ה/ב/ל/מ/ש/כ onto the next word ("לריצה" ~ "ריצה"); a leading
// one comes off when enough of the word is left to mean something. Sorted, so
// word order doesn't matter either.
export function queryKey(q) {
  return normalizeQuery(q).split(" ").filter(Boolean)
    .map((t) => (t.length >= 4 && /^[והבלמשכ]/.test(t) ? t.slice(1) : t))
    .sort().join(" ");
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms).unref?.())]);
}

/* ------------------------------ the list ---------------------------------- */

/**
 * The store's non-converting queries over the window, most searched first.
 * Every count is distinct sessions, so one shopper refreshing a page doesn't
 * make a query look popular.
 */
export async function computeWeakQueries(db, { now = new Date() } = {}) {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const bySession = (match, field) => [
    { $match: match },
    { $project: { q: { $toLower: { $trim: { input: { $toString: `$${field}` } } } }, s: { $ifNull: ["$session_id", "$sessionId"] } } },
    { $match: { q: { $nin: ["", null] }, s: { $nin: ["", null] } } },
    { $group: { _id: { q: "$q", s: "$s" } } },
    { $group: { _id: "$_id.q", sessions: { $sum: 1 } } },
  ];

  const [searched, clicked, carted, pinned] = await Promise.all([
    db.collection("queries").aggregate(bySession({ timestamp: { $gte: since } }, "query"), { allowDiskUse: true }).toArray(),
    db.collection("product_clicks").aggregate(bySession({ timestamp: { $gte: since }, search_query: { $type: "string" } }, "search_query")).toArray(),
    db.collection("cart").aggregate(bySession({ created_at: { $gte: since }, search_query: { $type: "string" } }, "search_query")).toArray(),
    db.collection("concierge_weak_queries").find({ enabled: { $ne: false } }).limit(MAX_LIST).toArray().catch(() => []),
  ]);

  // Spellings that normalize to the same key are one query.
  const stats = new Map();
  const bump = (rows, field) => {
    for (const row of rows) {
      const key = queryKey(row._id);
      if (!key) continue;
      const entry = stats.get(key) || { query: row._id, sessions: 0, clickSessions: 0, cartSessions: 0, top: 0 };
      entry[field] += row.sessions;
      if (field === "sessions" && row.sessions > entry.top) { entry.top = row.sessions; entry.query = row._id; }
      stats.set(key, entry);
    }
  };
  bump(searched, "sessions");
  bump(clicked, "clickSessions");
  bump(carted, "cartSessions");

  const list = [];
  for (const [key, s] of stats) {
    if (s.sessions < MIN_SESSIONS || s.cartSessions > 0) continue;
    if (s.clickSessions / s.sessions >= MAX_CLICK_RATE) continue;
    list.push({ key, query: s.query, sessions: s.sessions, click_sessions: s.clickSessions, source: "logs" });
  }
  list.sort((a, b) => b.sessions - a.sessions);

  for (const doc of pinned) {
    const key = queryKey(doc.query);
    if (!key) continue;
    const existing = list.find((w) => w.key === key);
    const note = typeof doc.note === "string" ? doc.note.slice(0, 600) : null;
    if (existing) { existing.note = note; existing.source = "pinned"; }
    else list.unshift({ key, query: String(doc.query), sessions: null, click_sessions: null, note, source: "pinned" });
  }
  return list.slice(0, MAX_LIST);
}

/**
 * Per-store cache with background refresh. A search never waits for the list
 * to be built: until the first build lands, nothing matches.
 */
export function createWeakQueryIndex(deps, { compute = computeWeakQueries, refreshMs = REFRESH_MS } = {}) {
  const byStore = new Map(); // dbName → { at, list, building }

  async function build(dbName) {
    const client = await deps.getMongoClient();
    const list = await compute(client.db(dbName));
    // Embeddings for the most searched part of the list, for matching by meaning.
    for (const entry of list.slice(0, MAX_EMBEDDED)) {
      try { entry.embedding = await deps.getQueryEmbedding(entry.query); } catch { entry.embedding = null; }
    }
    console.log(`[CONCIERGE] ${dbName}: ${list.length} known non-converting queries`);
    return list;
  }

  function listFor(dbName) {
    const cached = byStore.get(dbName);
    const stale = !cached || Date.now() - cached.at > refreshMs;
    if (stale && !cached?.building) {
      const entry = cached || { at: 0, list: [] };
      entry.building = build(dbName)
        .then((list) => { entry.list = list; entry.at = Date.now(); })
        .catch((err) => { entry.at = Date.now(); console.warn(`[CONCIERGE] weak-query refresh failed for ${dbName}:`, err.message); })
        .finally(() => { entry.building = null; });
      byStore.set(dbName, entry);
    }
    return byStore.get(dbName);
  }

  /** The known non-converting query this search is, or null. */
  async function match(store, query) {
    if (!store?.dbName || store.conciergeWeakQueries !== true) return null;
    const key = queryKey(query);
    if (!key) return null;
    const { list } = listFor(store.dbName);
    if (!list.length) return null;

    const exact = list.find((w) => w.key === key);
    if (exact) return { ...publicFields(exact), matched_by: "wording" };

    const embedded = list.filter((w) => Array.isArray(w.embedding));
    if (!embedded.length || typeof deps.getQueryEmbedding !== "function") return null;
    const vector = await withTimeout(deps.getQueryEmbedding(query).catch(() => null), SEMANTIC_TIMEOUT_MS);
    if (!vector) return null;
    let best = null, bestScore = 0;
    for (const w of embedded) {
      const score = cosine(vector, w.embedding);
      if (score > bestScore) { best = w; bestScore = score; }
    }
    return best && bestScore >= SEMANTIC_THRESHOLD
      ? { ...publicFields(best), matched_by: "meaning", score: Number(bestScore.toFixed(3)) }
      : null;
  }

  return { match, listFor };
}

function publicFields(w) {
  return { query: w.query, sessions: w.sessions, click_sessions: w.click_sessions, note: w.note || null, source: w.source };
}
