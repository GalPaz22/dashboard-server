import { applySerpPresentation } from './serp-presentation.mjs';
import { ObjectId } from 'mongodb';
import { findPinnedRuleForQuery } from './pinned-matching.mjs';

const aliases = value => [...new Set([String(value), String(value).split(':').pop()])];
const visible = row => row && row.hidden !== true && row.notInStore !== true && row.catalog_visibility !== 'hidden'
  && (!row.status || ['ACTIVE', 'active', 'publish', 'published'].includes(row.status));
const fields = { _id: 1, id: 1, name: 1, title: 1, sku: 1, price: 1, regularPrice: 1, currency: 1, image: 1, images: 1, url: 1, permalink: 1, category: 1, categories: 1, boost: 1, hidden: 1, notInStore: 1, catalog_visibility: 1, status: 1, stockStatus: 1, stock_status: 1 };

// Read commercial flags on every new search, outside the engine's cached catalog.
// Apply before saving the ranked snapshot so later pages keep the same order.
export async function applyMerchantRanking({ collection, matches, query, store = {} }) {
  const pins = findPinnedRuleForQuery(query, store)?.productIds || [];
  const excluded = new Set((store.excludedProductIds || []).map(String));
  const allowed = row => visible(row) && ![row._id, row.id].some(id => id != null && excluded.has(String(id)));
  const ids = [...new Set([...matches.map(p => p.id ?? p._id), ...pins].filter(id => id != null).flatMap(aliases))];
  if (!ids.length) return [];
  const values = ids.flatMap(id => Number.isFinite(Number(id)) ? [id, Number(id)] : [id]);
  const objectIds = ids.filter(id => /^[a-f\d]{24}$/i.test(id)).map(id => new ObjectId(id));
  const rows = await collection.find({ $or: [{ id: { $in: values } }, { _id: { $in: objectIds } }] }, { projection: fields, maxTimeMS: 5000 }).toArray();
  const byId = new Map();
  for (const row of rows) for (const id of [row.id, row._id].filter(id => id != null)) byId.set(String(id), row);
  const find = id => aliases(id).map(key => byId.get(key)).find(Boolean);
  const enrich = (p, row) => ({ ...p, boost: row.boost || 0, price: row.price ?? p.price, stockStatus: row.stockStatus || row.stock_status || p.stockStatus });
  const ranked = matches.map((p, index) => ({ p, row: find(p.id ?? p._id), index })).filter(x => allowed(x.row))
    .map(x => ({ ...x, p: enrich(x.p, x.row), boost: store.experimentBoosts?.[String(x.row._id)] ?? store.experimentBoosts?.[String(x.row.id)] ?? x.row.boost ?? 0 }))
    .sort((a, b) => b.boost - a.boost || a.index - b.index).map(x => x.p);
  const pinned = [], used = new Set();
  for (const id of pins) {
    const row = find(id);
    if (!allowed(row)) continue;
    const existing = ranked.find(p => find(p.id ?? p._id) === row);
    if ((row.stockStatus || row.stock_status) === 'outofstock' && !existing) continue;
    const key = String(row._id ?? row.id);
    if (used.has(key)) continue;
    used.add(key);
    pinned.push(enrich(existing || { id: String(row.id ?? row._id), name: row.name || row.title, title: row.name || row.title, sku: row.sku, image: row.image || row.images?.[0]?.src || row.images?.[0], url: row.url || row.permalink, categories: row.categories || row.category || [], currency: row.currency, badges: [] }, row));
  }
  return applySerpPresentation([...pinned, ...ranked.filter(p => !used.has(String(find(p.id ?? p._id)?._id ?? find(p.id ?? p._id)?.id)))].map(p=>({...p,_id:String(find(p.id??p._id)?._id||p._id||p.id)})),store);
}
