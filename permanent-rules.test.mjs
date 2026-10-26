import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermanentRuleLoader } from './permanent-rules.mjs';
import { applyPermanentRules } from './experiments-hook.mjs';

function fixture() {
  const store = { dbName: 'manoVino', apiKey: 'search-key' }, checks = [];
  const agent = { _id: 'agent', condition: { mode: 'queryMatch', patterns: ['הכורמים החופשיים'], matchType: 'exact' }, patch: { pinnedResults: [{ query: 'הכורמים החופשיים', productIds: ['old'] }] } };
  const merchant = { _id: 'merchant', merchantQuery: 'הכורמים החופשיים', condition: agent.condition, patch: { pinnedResults: [{ query: 'הכורמים החופשיים', productIds: ['first', 'second'] }], excludedProductIds: ['removed'] } };
  const state = { rows: [merchant, agent], reads: 0, fail: false };
  const client = { db: name => ({ collection: collection => ({ find(filter, options) {
    checks.push({ name, collection, filter, options });
    if (state.fail) throw Error('Mongo offline');
    return { sort() { return this; }, limit() { return this; }, async toArray() {
      if (collection === 'users') return [{ apiKey: 'tracking-key' }];
      state.reads++;
      return state.rows;
    } };
  } }) }) };
  return { store, checks, state, client, merchant, agent };
}

test('reads saved rules without Redis, scoped by dbName and legacy sibling keys', async () => {
  const f = fixture(), rules = await createPermanentRuleLoader()(f.store, f.client);
  assert.deepEqual(rules.map(r => r.id), ['agent', 'merchant']);
  assert.deepEqual(f.checks[1].filter, { status: 'active', $or: [
    { dbName: 'manoVino' },
    { dbName: { $exists: false }, tenantApiKey: { $in: ['search-key', 'tracking-key'] } },
  ] });
  assert.equal(f.checks[1].options.maxTimeMS, 2000);
  assert.equal(rules[1].merchantQuery, undefined);
});

test('coalesces reads and sees edits and removal after 15 seconds instead of reviving stale Redis', async () => {
  const f = fixture(); let time = 0; const load = createPermanentRuleLoader({ now: () => time });
  await Promise.all([load(f.store, f.client), load(f.store, f.client)]);
  assert.equal(f.state.reads, 1);
  f.state.rows = [];
  time = 14999;
  assert.equal((await load(f.store, f.client)).length, 2);
  time = 15000;
  assert.deepEqual(await load(f.store, f.client), []);
  assert.equal(f.state.reads, 2);
});

test('cache is isolated by store and bounded, and a failed read can recover', async () => {
  const f = fixture(), load = createPermanentRuleLoader({ maxEntries: 1 });
  await load(f.store, f.client);
  await load({ ...f.store, dbName: 'another-store' }, f.client);
  await load(f.store, f.client);
  assert.equal(f.state.reads, 3);
  const retry = createPermanentRuleLoader(); f.state.fail = true;
  await assert.rejects(retry(f.store, f.client), /Mongo offline/);
  f.state.fail = false;
  assert.equal((await retry(f.store, f.client)).length, 2);
});

test('search applies merchant ordering and removals without Studio publication and preserves exact query scope', async () => {
  const f = fixture(), db = { client: f.client };
  const result = await applyPermanentRules(f.store, '  הכורמים   החופשיים ', db, null, new Date(), { record: false });
  assert.deepEqual(result.pinnedResults[0].productIds, ['first', 'second']);
  assert.deepEqual(result.excludedProductIds, ['removed']);
  assert.deepEqual(await applyPermanentRules(f.store, 'יין אחר', db, null, new Date(), { record: false }), f.store);
  assert.equal(f.store.pinnedResults, undefined);
  assert.equal(f.state.reads, 1);
});

test('empty Mongo result overrides stale published rules; Mongo outages still use the Redis fallback', async () => {
  const empty = fixture(); empty.store = { ...empty.store, apiKey: 'empty-key' }; empty.state.rows = [];
  const redis = { get: async () => JSON.stringify([{ id: 'stale', condition: empty.agent.condition, patch: empty.agent.patch }]) };
  assert.deepEqual(await applyPermanentRules(empty.store, 'הכורמים החופשיים', { client: empty.client }, redis, new Date(), { record: false }), empty.store);
  const down = fixture(); down.store = { ...down.store, apiKey: 'outage-key' }; down.state.fail = true;
  const result = await applyPermanentRules(down.store, 'הכורמים החופשיים', { client: down.client }, redis, new Date(), { record: false });
  assert.deepEqual(result.pinnedResults[0].productIds, ['old']);
});
