import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficMonitor, observeRedisTraffic, observeGeminiTraffic, jsonBytes } from './network-traffic.mjs';

function fixture() {
  const lines = [];
  let now = 0;
  const monitor = createTrafficMonitor({ now: () => now, log: { log: (...args) => lines.push(args) } });
  return { monitor, lines, tick: value => { now += value; }, flush() {
    monitor.flush();
    return JSON.parse(lines.at(-1)[1]);
  } };
}

test('JSON byte counting includes Unicode, escaping and base64 without serializing the request', () => {
  const samples = [null, 1, Infinity, true, 'עברית 🟣', '\ud800', '\udc00', '"\\\n\t\u0000', [], Array(3), {},
    { a: undefined, b: [undefined, null], c: new Date(0) },
    { contents: [{ inlineData: { mimeType: 'image/jpeg', data: 'a'.repeat(1000000) } }, { text: 'מוצר' }] }];
  for (const value of samples) assert.equal(jsonBytes(value), Buffer.byteLength(JSON.stringify(value)));
});

test('Redis metrics count bytes and failures, preserve results, and never log keys or values', async () => {
  const f = fixture(), failure = new Error('offline');
  const redis = observeRedisTraffic({
    async get(key) { if (key === 'secret-failure') throw failure; return 'שלום'; },
    async setEx() { return 'OK'; }, async hmGet() { return ['state', null]; }, async eval() { return null; }
  }, f.monitor);
  assert.equal(await redis.get('simple-search:secret-query'), 'שלום');
  assert.equal(await redis.setEx('secret-key', 60, 'secret-value'), 'OK');
  await redis.hmGet('pagination:v2:secret-id', ['state', 'embeddings']);
  await assert.rejects(redis.get('secret-failure'), error => error === failure);
  f.tick(60000);
  const metrics = f.flush();
  assert.equal(metrics.windowMs, 60000);
  assert.deepEqual(metrics.traffic['redis.get.simple-search'], {
    operations: 1, failures: 0, sentBytes: Buffer.byteLength('simple-search:secret-query'), receivedBytes: Buffer.byteLength('שלום')
  });
  assert.equal(metrics.traffic['redis.get.other'].failures, 1);
  assert.ok(!JSON.stringify(f.lines).includes('secret'));
  f.monitor.flush();
  assert.equal(f.lines.length, 1, 'idle windows are quiet');
});

test('Gemini metrics distinguish image and text calls and count failed attempts', async () => {
  const f = fixture(), response = { text: 'תוצאה' }, failure = new Error('provider');
  const models = { marker: true, async generateContent(request) {
    assert.equal(this.marker, true);
    if (request.fail) throw failure;
    return response;
  } };
  observeGeminiTraffic(models, f.monitor);
  const image = { contents: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] };
  assert.equal(await models.generateContent(image), response);
  await models.generateContent({ contents: [{ text: 'חיפוש' }] });
  await assert.rejects(models.generateContent({ fail: true }), error => error === failure);
  const { traffic } = f.flush();
  assert.equal(traffic['gemini.image'].sentBytes, Buffer.byteLength(JSON.stringify(image)));
  assert.equal(traffic['gemini.image'].receivedBytes, Buffer.byteLength(response.text));
  assert.equal(traffic['gemini.text'].operations, 2);
  assert.equal(traffic['gemini.text'].failures, 1);
});

test('a call crossing a reporting window retains its completion metrics', () => {
  const f = fixture();
  const finish = f.monitor.start('gemini', 'text', 100);
  assert.equal(f.flush().traffic['gemini.text'].sentBytes, 100);
  finish(20, true);
  assert.deepEqual(f.flush().traffic['gemini.text'], { operations: 0, failures: 1, sentBytes: 0, receivedBytes: 20 });
});
