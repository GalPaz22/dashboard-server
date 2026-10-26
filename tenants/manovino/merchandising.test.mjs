import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { createTenantRoutes, manifest, storefrontResponse } from './index.mjs';
import { createSessions } from './sessions.mjs';
import { applyMerchantRanking } from '../../merchant-ranking.mjs';

const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } });
test('Mano Vino keeps Hebrew phrase pins, fresh boosts and visibility in a stable paginated result', async () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({ _id: new ObjectId(), id: index + 1, ItemID: index + 1001, name: `בירה ${index + 1}`, status: 'publish', stockStatus: 'instock' }));
  rows[1].boost = 3; rows[2].hidden = true;
  const documents = new Map();
  const sessions = { async createIndex() {}, async insertMany(values) { for (const value of values) documents.set(value._id, structuredClone(value)); }, async findOne(filter) { return documents.get(filter._id); } };
  const products = { find() { return { async toArray() { return rows; } }; } };
  const store = { dbName: 'manoVino', semantix: { module: 'manovino', enabled: true }, pinnedResults: [{ query: 'פחית, פחיות', enabled: true, productIds: [String(rows[5]._id)] }] };
  let freshCalls = 0;
  const search = async ({ request }) => {
    if (request.cursor) { assert.equal(request.merchandise, undefined); return createSessions(sessions).read(request.cursor, request.limit); }
    freshCalls++;
    const matches = await request.merchandise(rows.map(row => ({ id: `wine:${row.id}`, name: row.name })));
    return createSessions(sessions).save({ matches, total: matches.length, nextCursor: null, metadata: { revision: 5 } }, request.limit);
  };
  const routes = createTenantRoutes({ search, getDb: async name => { assert.equal(name, 'manoVino'); return { collection: () => products }; }, merchandise: (req, matches) => applyMerchantRanking({ collection: products, matches, query: req.body.query, store: req.store }) });
  const first = response();
  await routes.search({ store, body: { query: 'פחיות בירה', modern: true, limit: 2 } }, first, () => assert.fail('Unexpected legacy fallback'));
  assert.deepEqual(first.body.products.map(row => row.id), ['wine:6', 'wine:2']);
  assert.deepEqual(first.body.products.map(row => row.itemID), [1006, 1002]);
  assert.deepEqual(first.body.matches.map(row => row.ItemID), [1006, 1002]);
  assert.equal(first.body.metadata.searchEngine, 'semantix-manovino');
  assert.ok(first.body.pagination.nextToken.startsWith(manifest.tokenPrefix));
  // A later boost edit cannot reorder the middle of an already started search.
  rows[0].boost = 99;
  const rest = response();
  await routes.loadMore({ store, query: { token: first.body.pagination.nextToken, limit: 10 } }, rest, () => assert.fail());
  assert.deepEqual(rest.body.products.map(row => row.id), ['wine:1', 'wine:4', 'wine:5']);
  assert.deepEqual(rest.body.products.map(row => row.itemID), [1001, 1004, 1005]);
  assert.equal(freshCalls, 1);
  const next = response();
  await routes.search({ store, body: { query: 'פחיות בירה', modern: true, limit: 2 } }, next, () => assert.fail());
  assert.deepEqual(next.body.products.map(row => row.id), ['wine:6', 'wine:1']);
  const foreign = response(); let passed = false;
  await routes.loadMore({ store: { dbName: 'another-store' }, query: { token: first.body.pagination.nextToken } }, foreign, () => { passed = true; });
  assert.equal(foreign.statusCode, 400); assert.equal(passed, false);
});

test('legacy and modern responses expose the native identifier with both ItemID spellings', () => {
  const result = { matches: [{ id: 'engine-id', ItemID: 123 }, { id: 'other', itemID: '456' }] };
  for (const modern of [true, false]) {
    const response = storefrontResponse(result, modern), products = modern ? response.products : response;
    assert.deepEqual(products.map(p => [p.itemID, p.ItemID]), [[123, 123], ['456', '456']]);
  }
});
