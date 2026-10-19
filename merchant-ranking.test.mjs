import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { applyMerchantRanking } from './merchant-ranking.mjs';
import { createSearchSessions } from './tenants/beautics/sessions.mjs';
const row = (id, extra = {}) => ({ _id: new ObjectId(id.toString(16).padStart(24, '0')), id, name: `Product ${id}`, status: 'publish', stockStatus: 'instock', ...extra });
const collection = rows => ({ find(query, options) { assert.ok(query.$or); assert.equal(options.projection.embedding, undefined); return { async toArray() { return rows; } }; } });

test('manual boosts preserve organic relevance and read fresh flags outside the engine cache', async () => {
  const rows = [row(1), row(2, { boost: 3 }), row(3, { hidden: true }), row(4, { boost: 2 }), row(5)];
  const matches = [1, 2, 3, 5].map(id => ({ id: `tenant:${id}`, title: `Card ${id}` }));
  const args = { collection: collection(rows), matches, query: 'watch' };
  assert.deepEqual((await applyMerchantRanking(args)).map(p => p.id), ['tenant:2', 'tenant:1', 'tenant:5']);
  delete rows[1].boost; rows[0].boost = 3;
  assert.deepEqual((await applyMerchantRanking(args)).map(p => p.id), ['tenant:1', 'tenant:2', 'tenant:5']);
});
test('exact-query pins support platform ids and Mongo ids, prepend catalog-only products once, and reject hidden or sold-out pins', async () => {
  const rows = [row(1), row(2), row(3, { hidden: true }), row(4, { stockStatus: 'outofstock' }), row(5)];
  const args = { collection: collection(rows), matches: [{ id: 'tenant:1', title: 'One' }, { id: 'tenant:2', title: 'Two' }], query: '  RED   Wine ', store: { pinnedResults: [{ query: 'red wine', matchType: 'exact', productIds: ['5', String(rows[1]._id), '2', '3', '4'], enabled: true }] } };
  assert.deepEqual((await applyMerchantRanking(args)).map(p => p.id), ['5', 'tenant:2', 'tenant:1']);
  args.query = 'red wine glass'; assert.deepEqual((await applyMerchantRanking(args)).map(p => p.id), ['tenant:1', 'tenant:2']);
});
test('changed order is snapshotted before pagination; a fresh reader returns every product once', async () => {
  const rows = Array.from({ length: 9 }, (_, i) => row(i + 1));
  const documents = new Map();
  const storage = { async createIndex() {}, async insertMany(docs) { for (const d of docs) documents.set(d._id, d); }, async findOne(q) { return documents.get(q._id); } };
  const candidates = rows.map(r => ({ id: String(r.id) }));
  const store = { pinnedResults: [{ query: 'watch', enabled: true, productIds: ['9', '8'] }] };
  const transform = matches => applyMerchantRanking({ collection: collection(rows), matches, query: 'watch', store });
  const next = async () => ({ matches: candidates.slice(3), nextCursor: null });
  let page = await createSearchSessions(storage).save({ matches: candidates.slice(0, 3), total: 9, nextCursor: 'engine-page' }, next, 3, transform);
  const ids = page.matches.map(p => p.id);
  assert.deepEqual(ids, ['9', '8', '1']);
  while (page.nextCursor) { page = await createSearchSessions(storage).read(page.nextCursor, 3); ids.push(...page.matches.map(p => p.id)); }
  assert.equal(ids.length, 9); assert.equal(new Set(ids).size, 9);
});

test('admin phrases use the same Hebrew-aware matching in new engines, with the most specific phrase winning', async () => {
  const { findPinnedRuleForQuery } = await import('./pinned-matching.mjs');
  const broad = { query: 'watch, שעון', enabled: true, productIds: ['1'] };
  const specific = { query: 'שעון לנשים', enabled: true, productIds: ['2'] };
  assert.equal(findPinnedRuleForQuery('שעון נשים ספורט', {pinnedResults:[broad,specific]}), specific);
  assert.equal(findPinnedRuleForQuery('new WATCH black', {pinnedResults:[broad]}), broad);
  assert.equal(findPinnedRuleForQuery('watch band', {pinnedResults:[{...broad,query:'watch',matchType:'exact'}]}), null);
  assert.equal(findPinnedRuleForQuery('watch', {pinnedResults:[{...broad,enabled:false}]}), null);
});
