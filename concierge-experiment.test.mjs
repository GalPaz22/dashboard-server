import test from 'node:test';
import assert from 'node:assert/strict';
import { assignConcierge, experimentConfig, experimentReport, mountConciergeExperiment } from './concierge-experiment.mjs';
import { conciergeWeakQueryTrigger } from './concierge.mjs';

const testing = (percent, id = 'cx-1') => ({ dbName: 'garmin', conciergeEnabled: true, conciergeExperiment: { id, mode: 'test', percent } });

test('no experiment configured keeps the component on for everyone', () => {
  assert.deepEqual(experimentConfig({}), { id: null, mode: 'all', percent: 100 });
  assert.equal(assignConcierge({}, 'sess-1').show, true);
  assert.equal(assignConcierge({ conciergeExperiment: { id: 'x', mode: 'off' } }, 'sess-1').show, false);
  assert.equal(assignConcierge({ conciergeExperiment: { id: 'x', mode: 'all' } }, 'sess-1').show, true);
});

test('test mode splits sessions by percent, and a session keeps its arm', () => {
  let treated = 0;
  for (let i = 0; i < 4000; i++) {
    const a = assignConcierge(testing(30), `sess-${i}`);
    assert.equal(a.show, a.arm === 'treatment');
    if (a.arm === 'treatment') treated++;
    assert.equal(assignConcierge(testing(30), `sess-${i}`).arm, a.arm);
  }
  assert.ok(treated > 1050 && treated < 1350, `treated ${treated} of 4000`);
  assert.equal(assignConcierge(testing(0), 'sess-1').arm, 'control');
  assert.equal(assignConcierge(testing(100), 'sess-1').arm, 'treatment');
  assert.equal(assignConcierge(testing(50), null).show, false);
});

function routes(store, db) {
  const handlers = {};
  mountConciergeExperiment({ get: (p, h) => { handlers['GET ' + p] = h; }, post: (p, h) => { handlers['POST ' + p] = h; } }, {
    getMongoClient: async () => ({ db: () => db }), adminToken: () => 'secret',
  });
  const call = async (key, req) => {
    let status = 200, body = null;
    const res = { set() { return this; }, status(c) { status = c; return this; }, json(b) { body = b; return this; }, end() { return this; } };
    await handlers[key]({ store, query: {}, body: {}, get: () => null, ...req }, res);
    return { status, body };
  };
  return call;
}

function memoryDb(seed = {}) {
  const data = { ...seed };
  const col = (name) => {
    data[name] = data[name] || [];
    const rows = data[name];
    return {
      createIndex: async () => {},
      updateOne: async (filter, update) => {
        const row = rows.find((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
        if (!row) rows.push({ ...update.$setOnInsert, ...update.$set, exposures: 1 });
        else { Object.assign(row, update.$set); row.exposures++; }
      },
      insertMany: async (docs) => { rows.push(...docs); },
      find: (filter = {}) => {
        const match = (r) => Object.entries(filter).every(([k, v]) => (v && v.$in ? v.$in.includes(r[k]) : r[k] === v));
        return { project: () => ({ toArray: async () => rows.filter(match) }) };
      },
    };
  };
  return { collection: col, data };
}

test('assignment records exposure for tested sessions; events are only accepted from the treatment arm', async () => {
  const db = memoryDb();
  const store = testing(50);
  const call = routes(store, db);
  const treatment = [...Array(50).keys()].map((i) => `sess-${i}`).find((s) => assignConcierge(store, s).arm === 'treatment');
  const control = [...Array(50).keys()].map((i) => `sess-${i}`).find((s) => assignConcierge(store, s).arm === 'control');

  assert.deepEqual((await call('GET /concierge/assignment', { query: { session_id: treatment } })).body, { experiment_id: 'cx-1', arm: 'treatment', show: true });
  await call('GET /concierge/assignment', { query: { session_id: treatment } });
  await call('GET /concierge/assignment', { query: { session_id: control } });
  await new Promise((r) => setImmediate(r));
  assert.equal(db.data.concierge_ab_sessions.length, 2);
  assert.equal(db.data.concierge_ab_sessions.find((s) => s.session_id === treatment).exposures, 2);

  const send = (session_id) => call('POST /concierge/events', { body: { session_id, experiment_id: 'cx-1', events: [{ type: 'nudge_shown' }, { type: 'bogus' }] } });
  assert.equal((await send(treatment)).body.accepted, 1);
  assert.equal((await send(control)).body.accepted, 0);
  assert.equal(db.data.concierge_ab_events.length, 1);
});

test('the report needs the admin token', async () => {
  const call = routes(testing(50), memoryDb());
  assert.equal((await call('GET /concierge/experiment-report', {})).status, 404);
  assert.equal((await call('GET /concierge/experiment-report', { get: () => 'secret' })).status, 200);
});

test('report: outcomes per arm count only what happened after assignment', async () => {
  const t0 = new Date('2026-10-27T10:00:00Z'), later = new Date('2026-10-27T11:00:00Z'), before = new Date('2026-10-27T09:00:00Z');
  const db = memoryDb({
    concierge_ab_sessions: [
      { experiment_id: 'cx-1', session_id: 't1', arm: 'treatment', first_seen: t0 },
      { experiment_id: 'cx-1', session_id: 't2', arm: 'treatment', first_seen: t0 },
      { experiment_id: 'cx-1', session_id: 'c1', arm: 'control', first_seen: t0 },
      { experiment_id: 'cx-1', session_id: 'c2', arm: 'control', first_seen: t0 },
    ],
    product_clicks: [{ session_id: 't1', timestamp: later }, { session_id: 't1', timestamp: later }, { session_id: 'c1', timestamp: before }],
    cart: [{ session_id: 't1', created_at: later }],
    checkout_events: [{ session_id: 't1', total_price: 2499, created_at: later }, { session_id: 'c2', total_price: 999, created_at: later }],
    concierge_ab_events: [
      { experiment_id: 'cx-1', session_id: 't1', type: 'nudge_shown' }, { experiment_id: 'cx-1', session_id: 't2', type: 'nudge_shown' },
      { experiment_id: 'cx-1', session_id: 't1', type: 'message_sent' }, { experiment_id: 'cx-1', session_id: 't1', type: 'panel_opened', reason: 'rephrased' },
    ],
  });
  const r = await experimentReport(db, 'cx-1');
  assert.deepEqual(
    { ...r.arms.treatment },
    { sessions: 2, clicked: 1, added_to_cart: 1, ordered: 1, orders: 1, revenue: 2499, click_rate: 0.5, cart_rate: 0.5, order_rate: 0.5, revenue_per_session: 1249.5 },
  );
  assert.equal(r.arms.control.clicked, 0); // c1's click came before assignment
  assert.equal(r.arms.control.ordered, 1);
  assert.deepEqual(r.engagement.nudge_shown, { events: 2, sessions: 2 });
  assert.deepEqual(r.engagement['panel_opened:rephrased'], { events: 1, sessions: 1 });
  assert.equal(r.engagement.engaged_rate, 0.5);
});

test('the search trigger stays out of control-arm searches', async () => {
  const store = { ...testing(50), conciergeWeakQueries: true };
  const control = [...Array(50).keys()].map((i) => `sess-${i}`).find((s) => assignConcierge(store, s).arm === 'control');
  const middleware = conciergeWeakQueryTrigger({ getRedis: () => null, weakQueries: { match: async () => ({ query: 'q' }) } });
  const req = { path: '/search', body: { query: 'q', session_id: control }, store };
  const res = { json: () => 'original' };
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
  assert.equal(res.json(), 'original');
});
