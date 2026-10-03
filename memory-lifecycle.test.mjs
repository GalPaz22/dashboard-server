import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExpiringMap, withTimeout } from './memory-lifecycle.mjs';

test('idle entries are released by periodic cleanup, including deadline metadata', t => {
  t.mock.timers.enable({apis:['setInterval']});
  let now = 0;
  const cache = new ExpiringMap({now:()=>now, ttlMs:100, sweepMs:100});
  try {
    cache.set('a', {value:'large payload'});
    now = 100;
    t.mock.timers.tick(100);
    assert.equal(cache.size,0);
    assert.equal(cache.deadlines.size,0);
  } finally { cache.dispose(); }
});

test('unique-key bursts stay bounded and updating an existing key preserves other entries', () => {
  const cache = new ExpiringMap({maxEntries:50});
  try {
    for(let i=0;i<10000;i++) cache.set(i,{value:i});
    assert.equal(cache.size,50);
    assert.equal(cache.deadlines.size,50);
    cache.set(9999,{value:'updated'});
    assert.equal(cache.size,50);
    assert.equal(cache.get(9950).value,9950);
    cache.clear();
    assert.equal(cache.deadlines.size,0);
  } finally { cache.dispose(); }
});

test('explicit deadlines expire at the boundary and updates extend the lifetime', () => {
  let now=0;
  const cache=new ExpiringMap({now:()=>now});
  try {
    cache.set('a',{expiresAt:10});
    now=9;
    cache.set('a',{expiresAt:20});
    now=10;
    assert.ok(cache.get('a'));
    now=20;
    assert.equal(cache.get('a'),undefined);
    assert.equal(cache.size,0);
  } finally {cache.dispose();}
});

test('timeouts are cleared after successful and failed operations', async t => {
  const clear=t.mock.method(globalThis,'clearTimeout');
  assert.equal(await withTimeout(Promise.resolve('ok'),60000,'late'),'ok');
  await assert.rejects(withTimeout(Promise.reject(Error('provider')),60000,'late'),/provider/);
  assert.equal(clear.mock.callCount(),2);
});

test('hanging operations time out and late failures remain handled', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let reject;
  const pending=new Promise((_,r)=>{reject=r;});
  const result=withTimeout(pending,100,'deadline exceeded');
  const assertion=assert.rejects(result,/deadline exceeded/);
  t.mock.timers.tick(100);
  await assertion;
  reject(Error('late provider failure'));
  await Promise.resolve();
});
