import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWeakQueries, createWeakQueryIndex, queryKey } from './concierge-weak-queries.mjs';
import { conciergeWeakQueryTrigger, knownWeakTrigger } from './concierge.mjs';

// Rows as the aggregation returns them: one per query, distinct-session counts.
function fakeDb({ queries = [], clicks = [], carts = [], pinned = [] }) {
  const rows = { queries, product_clicks: clicks, cart: carts };
  return {
    collection(name) {
      if (name === 'concierge_weak_queries') return { find: () => ({ limit: () => ({ toArray: async () => pinned }) }) };
      return { aggregate: () => ({ toArray: async () => rows[name] }) };
    },
  };
}

test('query keys ignore niqqud, final letters, punctuation, glued prefixes and word order', () => {
  assert.equal(queryKey('שעון לריצה עם מפות!'), queryKey('שעון ריצה עם מפות'));
  assert.equal(queryKey('מפות שעון'), queryKey('שעון מפות'));
  assert.equal(queryKey('שָׁעוֹן'), queryKey('שעון'));
  assert.notEqual(queryKey('שעון ריצה'), queryKey('שעון שחייה'));
});

test('a query is non-converting when enough sessions search it, few click and none add to cart', async () => {
  const list = await computeWeakQueries(fakeDb({
    queries: [
      { _id: 'שעון עם מפות', sessions: 9 }, { _id: 'שעון  עם מפות', sessions: 2 },
      { _id: 'fenix 8', sessions: 20 }, { _id: 'forerunner 965', sessions: 6 }, { _id: 'רצועה', sessions: 2 },
    ],
    clicks: [{ _id: 'fenix 8', sessions: 2 }, { _id: 'forerunner 965', sessions: 4 }],
    carts: [{ _id: 'fenix 8', sessions: 1 }],
  }));
  // fenix 8 sold once; forerunner 965 is clicked by 4/6; רצועה is too rare.
  assert.deepEqual(list.map((w) => w.query), ['שעון עם מפות']);
  assert.equal(list[0].sessions, 11);
});

test('pinned queries are always listed and carry the merchant note', async () => {
  const list = await computeWeakQueries(fakeDb({
    queries: [{ _id: 'שעון עם מפות', sessions: 5 }],
    pinned: [{ query: 'שעון עם מפות', note: 'מפות יש רק בדגמי Fenix, Epix ו-Forerunner 965' }, { query: 'שעון לצלילה' }],
  }));
  assert.equal(list.length, 2);
  assert.equal(list.find((w) => w.query === 'שעון עם מפות').note, 'מפות יש רק בדגמי Fenix, Epix ו-Forerunner 965');
  assert.equal(list.find((w) => w.query === 'שעון לצלילה').source, 'pinned');
});

const vectors = { 'שעון עם מפות': [1, 0, 0], 'שעון עם ניווט במפה': [0.95, 0.2, 0], 'רצועת סיליקון': [0, 0, 1] };
function index(list) {
  return createWeakQueryIndex({
    getMongoClient: async () => ({ db: () => null }),
    getQueryEmbedding: async (text) => vectors[text] || [0, 1, 0],
  }, { compute: async () => list.map((w) => ({ ...w, key: queryKey(w.query) })) });
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test('matching: by wording, then by meaning; never for a store that has not opted in', async () => {
  const weak = index([{ query: 'שעון עם מפות', sessions: 9, source: 'logs' }]);
  const store = { dbName: 'garmin', conciergeWeakQueries: true };
  assert.equal(await weak.match(store, 'שעון עם מפות'), null); // first call only starts the build
  await settle();
  assert.equal((await weak.match(store, 'שעון, עם מפות')).matched_by, 'wording');
  const meaning = await weak.match(store, 'שעון עם ניווט במפה');
  assert.equal(meaning.matched_by, 'meaning');
  assert.equal(meaning.query, 'שעון עם מפות');
  assert.equal(await weak.match(store, 'רצועת סיליקון'), null);
  assert.equal(await weak.match({ dbName: 'garmin', conciergeEnabled: true }, 'שעון עם מפות'), null);
});

test('known_weak only fires on a search that returned something in stock', () => {
  const store = { dbName: 'garmin' };
  const weak = { query: 'שעון עם מפות', sessions: 9 };
  assert.equal(knownWeakTrigger({ payload: { products: [] }, query: 'q', store, weak }), null);
  assert.equal(knownWeakTrigger({ payload: { products: [{ id: 1, stockStatus: 'outofstock' }] }, query: 'q', store, weak }), null);
  assert.equal(knownWeakTrigger({ payload: { products: [{ id: 1 }] }, query: 'q', store, weak: null }), null);
  const trigger = knownWeakTrigger({ payload: { products: [{ id: 7 }, { id: 8 }] }, query: 'q', store, weak });
  assert.equal(trigger.reason, 'known_weak');
  assert.deepEqual(trigger.product_ids, ['7', '8']);
});

test('the known-weak middleware stamps the response but keeps the match details server-side', async () => {
  const middleware = conciergeWeakQueryTrigger({
    getRedis: () => null,
    weakQueries: { match: async () => ({ query: 'שעון עם מפות', sessions: 9, note: 'פנימי' }) },
  });
  const headers = {}; let sent = null;
  const req = { path: '/search', body: { query: 'שעון עם מפות', session_id: 's1' }, store: { dbName: 'garmin', conciergeEnabled: true, conciergeWeakQueries: true } };
  const res = { headersSent: false, setHeader: (k, v) => { headers[k] = v; }, json: (payload) => { sent = payload; return payload; } };
  middleware(req, res, () => {});
  await res.json({ products: [{ id: 1 }] });
  assert.equal(headers['X-Concierge-Trigger'], 'known_weak');
  assert.equal(sent.metadata.concierge.reason, 'known_weak');
  assert.equal(sent.metadata.concierge.weak, undefined);
});
