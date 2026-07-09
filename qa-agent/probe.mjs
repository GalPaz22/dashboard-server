// Fetches "should-have-matched" candidate products straight from the store's
// products collection, so the diagnose step can compare what search returned
// against what plausibly exists. Pure text probe (no embeddings) — domain-agnostic.
import { getClient } from "./db.mjs";
import { config } from "./config.mjs";

function tokens(q) {
  return String(q || "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns up to probeK products whose name/description/category text overlaps the
 * query tokens. These are candidates the search *could* have surfaced.
 */
export async function probeCandidates(store, query) {
  const client = await getClient();
  const coll = client.db(store.dbName).collection("products");
  const toks = tokens(query);
  if (!toks.length) return [];

  const ors = [];
  for (const t of toks) {
    const rx = { $regex: escapeRegex(t), $options: "i" };
    ors.push({ name: rx }, { Name: rx }, { description: rx }, { Description: rx }, { category: rx }, { Category: rx }, { softCategory: rx }, { type: rx });
  }

  const docs = await coll
    .find({ $or: ors }, {
      projection: { id: 1, ItemID: 1, name: 1, Name: 1, category: 1, Category: 1, type: 1, softCategory: 1, price: 1, Price: 1, description: 1, Description: 1 },
    })
    .limit(config.probeK)
    .toArray()
    .catch(() => []);

  return docs.map((p) => ({
    id: p.id ?? p.ItemID ?? p._id ?? null,
    name: p.name || p.Name || "",
    category: p.category ?? p.Category ?? null,
    type: p.type ?? null,
    softCategory: p.softCategory ?? null,
    price: p.price ?? p.Price ?? null,
    description: typeof (p.description || p.Description) === "string" ? String(p.description || p.Description).slice(0, 160) : null,
  }));
}
