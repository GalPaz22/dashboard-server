import test from 'node:test';
import assert from 'node:assert/strict';
import { consultativeTrigger, conciergeWeakQueryTrigger } from './concierge.mjs';

const store = { dbName: 'garmin', conciergeEnabled: true };
const consult = (products = [{ id: 1 }, { id: 2, stockStatus: 'outofstock' }]) => ({ products, metadata: { routerRoute: 'consultative' } });

test('consultative: fires on the router route only, and can be turned off per store', () => {
  const t = consultativeTrigger({ payload: consult(), query: 'איזה שעון מתאים למתחילים?', store });
  assert.equal(t.reason, 'consultative');
  assert.equal(t.display, 'auto');
  assert.deepEqual(t.product_ids, ['1']); // out-of-stock products are not offered
  assert.equal(consultativeTrigger({ payload: consult([]), query: 'מה ההבדל בין fenix ל-epix', store }).reason, 'consultative');
  for (const route of ['lexical', 'semantic', 'clarify', 'unavailable', undefined]) {
    assert.equal(consultativeTrigger({ payload: { products: [{ id: 1 }], metadata: { routerRoute: route } }, query: 'fenix 8', store }), null);
  }
  assert.equal(consultativeTrigger({ payload: consult(), query: 'q?', store: { ...store, conciergeConsultative: false } }), null);
  assert.equal(consultativeTrigger({ payload: [{ id: 1 }], query: 'q?', store }), null);
});

test('the Garmin search middleware stamps consultative searches without needing the weak-query opt-in', async () => {
  const middleware = conciergeWeakQueryTrigger({ getRedis: () => null, weakQueries: { match: async () => null } });
  const headers = {}; let sent = null;
  const req = { path: '/search', body: { query: 'איזה שעון מתאים למתחילים?', session_id: 's1' }, store };
  const res = { headersSent: false, setHeader: (k, v) => { headers[k] = v; }, json: (payload) => { sent = payload; return payload; } };
  middleware(req, res, () => {});
  await res.json(consult());
  assert.equal(headers['X-Concierge-Trigger'], 'consultative');
  assert.equal(sent.metadata.concierge.reason, 'consultative');
  assert.equal(sent.metadata.concierge.query, 'איזה שעון מתאים למתחילים?');
});

test('a regular Garmin search passes through untouched', async () => {
  const middleware = conciergeWeakQueryTrigger({ getRedis: () => null });
  let sent = null;
  const res = { headersSent: false, setHeader() {}, json: (payload) => { sent = payload; return payload; } };
  middleware({ path: '/search', body: { query: 'fenix 8' }, store }, res, () => {});
  await res.json({ products: [{ id: 1 }], metadata: { fullMatch: true } });
  assert.equal(sent.metadata.concierge, undefined);
});
