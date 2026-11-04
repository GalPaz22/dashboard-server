import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { createClient } from 'redis';
import { savePaginationState, readPaginationState, appendPaginationIds } from './pagination-store.mjs';

let processHandle, redis, directory;
before(async () => {
  directory = await mkdtemp('/tmp/dashboard-pagination-');
  const socket = `${directory}/redis.sock`;
  processHandle = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no']);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Test Redis did not start')), 5000);
    timer.unref();
    processHandle.once('error', error => { clearTimeout(timer); reject(error); });
    processHandle.once('exit', code => { clearTimeout(timer); reject(Error(`Test Redis exited: ${code}`)); });
    processHandle.stdout.on('data', data => {
      if (/ready to accept connections/i.test(String(data))) { clearTimeout(timer); resolve(); }
    });
  });
  redis = createClient({ socket: { path: socket, reconnectStrategy: false } });
  redis.on('error', () => {});
  await redis.connect();
});
after(async () => {
  if (redis?.isOpen) await redis.quit();
  if (processHandle && processHandle.exitCode === null) {
    const exited = once(processHandle, 'exit');
    processHandle.kill('SIGTERM');
    await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('pagination updates retain vectors but only transmit new IDs and small metadata', async () => {
  const vectors = [{ _id: 'seed', name: 'מוצר', embedding: Array(1536).fill(0.123456789) }];
  const initial = { topProductEmbeddings: vectors, deliveredIds: ['first'], batchNumber: 1, lastUpdate: 1 };
  await savePaginationState(redis, 'vectors', initial, 60);
  assert.deepEqual(await readPaginationState(redis, 'vectors'), initial);
  const commands = [];
  const observed = { eval: async (script, options) => { commands.push(options); return redis.eval(script, options); } };
  const updated = await appendPaginationIds(observed, 'vectors', ['second'], 2, 120);
  assert.deepEqual(updated.deliveredIds, ['first', 'second']);
  assert.equal(updated.batchNumber, 2);
  assert.ok(updated.lastUpdate > 1);
  assert.ok(Buffer.byteLength(JSON.stringify(commands)) < 500);
  assert.ok(!JSON.stringify(commands).includes('0.123456789'));
  const stored = await readPaginationState(redis, 'vectors');
  assert.deepEqual(stored.topProductEmbeddings, vectors);
  assert.deepEqual(stored.deliveredIds, ['first', 'second']);
  assert.ok(await redis.ttl('pagination:v2:vectors') >= 119);
});

test('concurrent appends do not lose delivered IDs', async () => {
  await savePaginationState(redis, 'concurrent', { deliveredIds: [], batchNumber: 1 }, 60);
  await Promise.all(Array.from({ length: 20 }, (_, i) => appendPaginationIds(redis, 'concurrent', [String(i)], 2, 60)));
  const state = await readPaginationState(redis, 'concurrent');
  assert.equal(state.deliveredIds.length, 20);
  assert.equal(new Set(state.deliveredIds).size, 20);
});

test('empty delivered ID arrays remain arrays after Lua updates', async () => {
  await savePaginationState(redis, 'empty', { deliveredIds: [], batchNumber: 1 }, 60);
  const state = await appendPaginationIds(redis, 'empty', [], 2, 60);
  assert.deepEqual(state.deliveredIds, []);
  assert.deepEqual((await readPaginationState(redis, 'empty')).topProductEmbeddings, []);
});

test('legacy sessions are readable and migrate on update without losing vectors', async () => {
  const initial = { deliveredIds: ['one'], topProductEmbeddings: [{ embedding: [0.12, 0.34] }], batchNumber: 1 };
  await redis.setEx('pagination:legacy', 60, JSON.stringify(initial));
  assert.deepEqual(await readPaginationState(redis, 'legacy'), initial);
  await Promise.all([
    appendPaginationIds(redis, 'legacy', ['two'], 2, 60),
    appendPaginationIds(redis, 'legacy', ['three'], 2, 60)
  ]);
  const updated = await readPaginationState(redis, 'legacy');
  assert.deepEqual(updated.topProductEmbeddings, initial.topProductEmbeddings);
  assert.deepEqual(new Set(updated.deliveredIds), new Set(['one', 'two', 'three']));
});

test('absent and expired sessions return null and immutable vectors expire with state', async () => {
  assert.equal(await readPaginationState(redis, 'absent'), null);
  assert.equal(await appendPaginationIds(redis, 'absent', ['id'], 2, 60), null);
  await savePaginationState(redis, 'expiry', { topProductEmbeddings: [{ embedding: [1] }], deliveredIds: ['id'] }, 1);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(await readPaginationState(redis, 'expiry'), null);
  assert.equal(await redis.exists('pagination:v2:expiry'), 0);
});
