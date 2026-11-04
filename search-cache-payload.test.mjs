import test from 'node:test';
import assert from 'node:assert/strict';
import { compactSearchPayload, paginationTokenCategories } from './search-cache-payload.mjs';

test('search cache retains product fields and match metadata while removing only vectors', () => {
  const original = { results: [{ _id: 'id', name: 'מוצר', embedding: Array(1536).fill(0.123456789),
    merchantSpecific: { size: 'L' }, exactMatchBonus: 50000, softCategory: ['סגול'] }],
    isPerfectFilterMatch: true, filterCheck: { matchedColors: ['סגול'] }, queryWords: ['מוצר'] };
  const compact = compactSearchPayload(original);
  assert.equal(compact.results[0].embedding, undefined);
  assert.deepEqual(compact.results[0].merchantSpecific, { size: 'L' });
  assert.equal(compact.results[0].exactMatchBonus, 50000);
  assert.equal(compact.filterCheck, original.filterCheck);
  assert.equal(original.results[0].embedding.length, 1536, 'does not mutate shared products');
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(original)) / 10);
});

test('restored embeddings stay out of subsequent pagination tokens', () => {
  const categories = { hardCategories: ['קוסמטיקה'], softCategories: ['סגול'], tier2BoostMap: { סגול: 100 },
    topProductEmbeddings: [{ _id: 'id', embedding: [0.1, 0.2] }] };
  const token = JSON.parse(Buffer.from(JSON.stringify({ extractedCategories: paginationTokenCategories(categories) })).toString());
  assert.deepEqual(token.extractedCategories, { hardCategories: ['קוסמטיקה'], softCategories: ['סגול'], tier2BoostMap: { סגול: 100 } });
  assert.ok(categories.topProductEmbeddings);
  assert.equal(paginationTokenCategories(null), null);
});
