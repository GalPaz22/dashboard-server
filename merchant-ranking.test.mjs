import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { applyMerchantRanking } from './merchant-ranking.mjs';
import { createSearchSessions } from './tenants/beautics/sessions.mjs';
const row = (id, extra = {}) => ({ _id: new ObjectId(id.toString(16).padStart(24, '0')), id, name: `Product ${id}`, status: 'publish', stockStatus: 'instock', ...extra });
const collection = rows => ({ find(query, options) { assert.ok(query.$or); assert.equal(options.projection.embedding, undefined); return { async toArray() { return rows; } }; } });

test('catalog-only pins and organic results preserve platform ItemID independently of id and Mongo _id', async () => {
  const rows = [row(1, { ItemID: 9001 }), row(2, { ItemID: 9002 }), row(3, { itemID: 'platform-three' })];
  const products = { find(query, { projection }) {
    return { async toArray() { return rows.map(source => Object.fromEntries(Object.keys(projection).filter(key => key in source).map(key => [key, source[key]]))); } };
  } };
  const result = await applyMerchantRanking({ collection: products, matches: [{ id: 'tenant:1' }], query: 'wine',
    store: { pinnedResults: [{ query: 'wine', productIds: ['2', '3'] }] } });
  assert.deepEqual(result.map(p => p.id), ['2', '3', 'tenant:1']);
  assert.equal(result[0].ItemID, 9002); assert.equal(result[1].itemID, 'platform-three'); assert.equal(result[2].ItemID, 9001);
});

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
test('query exclusions override pins, resolve native and Mongo ids, and keep organic pagination stable',async()=>{
 const rows=[row(1),row(2),row(3)];
 const store={excludedProductIds:[String(rows[1]._id)],pinnedResults:[{query:'סרום',matchType:'exact',productIds:[String(rows[1]._id),String(rows[2]._id)]}]};
 const result=await applyMerchantRanking({collection:collection(rows),matches:[{id:'tenant:1'},{id:'tenant:2'}],query:'סרום',store});
 assert.deepEqual(result.map(x=>x.id),['3','tenant:1']);
});
test('excluded-only permanent rules apply to exactly one query without global hiding',async()=>{
 const {applyPermanentRules}=await import('./experiments-hook.mjs');
 const redis={async get(){return JSON.stringify([{id:'demo',condition:{mode:'queryMatch',patterns:['red wine'],matchType:'exact'},patch:{excludedProductIds:['2']}}]);}};
 const store={apiKey:'fixture-query-demo'};
 assert.deepEqual((await applyPermanentRules(store,'RED   WINE',null,redis,new Date(),{record:false})).excludedProductIds,['2']);
 assert.equal((await applyPermanentRules(store,'red wine glass',null,redis,new Date(),{record:false})).excludedProductIds,undefined);
});
test('legacy and modern exclusion filters preserve metadata and never affect unrelated products',async()=>{
 const {filterExcludedProducts}=await import('./query-result-exclusions.mjs');const products=[{_id:'1'},{id:'tenant:2'},{id:3}];
 assert.deepEqual(filterExcludedProducts(products,['2']),[{_id:'1'},{id:3}]);
 assert.deepEqual(filterExcludedProducts({products,count:3,metadata:{next:'cursor'}},['2']).metadata,{next:'cursor'});
});
test('an explicitly arranged exact query wins over a longer Hebrew prefix phrase',async()=>{
 const {findPinnedRuleForQuery}=await import('./pinned-matching.mjs');const fuzzy={query:'לנשים',productIds:['1']},exact={query:'נשים',matchType:'exact',productIds:['2']};assert.equal(findPinnedRuleForQuery('נשים',{pinnedResults:[fuzzy,exact]}),exact);
});
