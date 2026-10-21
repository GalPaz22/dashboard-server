import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryMonitor, heapLimitMB } from './memory-monitor.mjs';

const MB = 1048576;
function setup(options = {}) {
  let heapMB = 100, now = 0;
  const lines = [], log = {warn: l => lines.push(['warn', l]), error: l => lines.push(['error', l])};
  const monitor = createMemoryMonitor({limitMB: 1000, usage: () => ({heapUsed: heapMB * MB, heapTotal: (heapMB + 20) * MB, rss: (heapMB + 300) * MB}), now: () => now, log, ...options});
  return {monitor, lines, set: mb => { heapMB = mb; }, tick: ms => { now += ms; }};
}

test('thresholds follow the heap limit, not a fixed 512MB plan', () => {
  const {monitor, lines, set} = setup();
  assert.equal(monitor.warningMB, 750);
  assert.equal(monitor.criticalMB, 900);
  set(610);
  assert.equal(monitor.check('After POST /search-to-cart').level, null, 'a steady 610MB heap on a 1000MB limit is not an alarm');
  assert.equal(lines.length, 0);
  assert.ok(heapLimitMB() > 0);
});

test('explicit thresholds override the ratios', () => {
  const {monitor} = setup({warningMB: 500, criticalMB: 600});
  assert.equal(monitor.warningMB, 500);
  assert.equal(monitor.criticalMB, 600);
});

test('a heap that stays high logs once per interval per level, not on every request', () => {
  const {monitor, lines, set, tick} = setup();
  set(950);
  for (let i = 0; i < 100; i++) monitor.check('After POST /site-config');
  assert.equal(lines.length, 1);
  assert.equal(lines[0][0], 'error');
  assert.match(lines[0][1], /\[MEMORY CRITICAL\] After POST \/site-config - Heap: 950MB \/ Total: 970MB \/ Limit: 1000MB \/ RSS: 1250MB/);
  set(800);
  monitor.check('x');
  assert.deepEqual(lines.map(l => l[0]), ['error', 'warn'], 'warning has its own interval');
  tick(59999);
  set(950); monitor.check('x');
  assert.equal(lines.length, 2);
  tick(1);
  monitor.check('x');
  assert.equal(lines.length, 3, 'logged again once the interval has passed');
});
