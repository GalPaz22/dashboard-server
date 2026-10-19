import test from 'node:test';
import assert from 'node:assert/strict';
import { liveConciergeSettings } from './concierge-settings.mjs';
import { buildSystemPrompt, mountConcierge } from './concierge.mjs';

test('new turns read fresh merchant instructions while preserving authenticated store and activation', async () => {
  let instructions = 'הוראה ראשונה';
  const store = { dbName: 'woo-beautics-shop-co-il', conciergeEnabled: false, context: 'מקצועי', conciergeSystemPrompt: 'stale cached prompt' };
  const mongo = async () => ({ db(name) { assert.equal(name, 'users'); return { collection: () => ({ find(filter) {
    assert.deepEqual(filter, { dbName: store.dbName });
    return { sort() { return this; }, async toArray() { return [
      { credentials: { dbName: 'other' }, platform: 'woocommerce', conciergeInstructions: 'foreign' },
      { conciergeInstructions: 'secondary' },
      { platform: 'woocommerce', conciergeInstructions: instructions, conciergeSystemPrompt: null, credentials: { dbName: store.dbName, conciergeContext: 'רקע' } },
    ]; } };
  } }) }; } });
  const first = await liveConciergeSettings(store, mongo);
  assert.equal(first.conciergeInstructions, instructions); assert.equal(first.conciergeEnabled, false);
  assert.equal(first.conciergeSystemPrompt, null); assert.equal(first.dbName, store.dbName);
  let prompt = buildSystemPrompt(first);
  assert.ok(prompt.includes('ביוטיקס')); assert.ok(prompt.includes('רקע')); assert.ok(prompt.includes(instructions)); assert.ok(!prompt.includes('stale cached prompt'));
  instructions = 'הוראה חדשה';
  prompt = buildSystemPrompt(await liveConciergeSettings(store, mongo));
  assert.ok(prompt.includes(instructions)); assert.ok(!prompt.includes('הוראה ראשונה'));
});
test('chat authenticates before loading prompt settings and fails clearly if fresh settings cannot be read', async () => {
  const handlers = {}; let reads = 0;
  mountConcierge({ post(path, handler) { handlers[path] = handler; }, get() {} }, {
    getMongoClient: async () => null, getQueryEmbedding: async () => [], getRedis: () => null,
    getConciergeSettings: async () => { reads++; throw Error('fixture unavailable'); },
  });
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  let res = response(); await handlers['/concierge/chat']({ store: { conciergeEnabled: false } }, res);
  assert.equal(res.code, 403); assert.equal(reads, 0);
  res = response(); await handlers['/concierge/chat']({ store: { conciergeEnabled: true } }, res);
  assert.equal(res.code, 503); assert.equal(res.body.error, 'concierge_settings_unavailable'); assert.equal(reads, 1);
});
