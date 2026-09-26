#!/usr/bin/env node
/**
 * Search evaluation harness.
 *
 * Replays real shopper traffic against a running server and diffs two builds.
 * It exists because parts of the pipeline are non-deterministic — the LLM
 * translates "רצועות לשעון" as either "watch straps" or "watch bands" — so a
 * single before/after comparison cannot tell a regression from noise.
 *
 * That variance does NOT show up when a query is repeated inside one server
 * process; it shows up between processes. So a build is measured with several
 * passes, each against a freshly started server, and a query that disagrees
 * across its own build's passes is excluded from the verdict instead of being
 * counted as a change.
 *
 *   node eval/search-eval.mjs pull  [--per-store 150] [--min-traffic 200]
 *   node eval/search-eval.mjs run   --label before-1 [--url ...] [--stores a,b] [--limit N]
 *   node eval/search-eval.mjs diff  before-1,before-2,before-3  after-1,after-2,after-3
 *
 * Restart the server between passes, otherwise the passes share caches and the
 * instability the harness exists to catch stays invisible.
 *
 * Snapshots land in eval/snapshots/<label>.json.
 */

import { MongoClient } from 'mongodb';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = join(EVAL_DIR, 'corpus.json');
const SNAPSHOT_DIR = join(EVAL_DIR, 'snapshots');

const args = process.argv.slice(3);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

async function mongo() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  return client;
}

/* ------------------------------------------------------------------ pull */

// One account per catalog: several people can share a dbName, and the store's
// own account is the one carrying an apiKey and a syncMode.
async function storeAccounts(client) {
  const users = await client.db('users').collection('users')
    .find({ apiKey: { $exists: true }, dbName: { $exists: true }, syncMode: { $exists: true } })
    .toArray();

  const byDb = new Map();
  for (const user of users) {
    if (!byDb.has(user.dbName)) {
      byDb.set(user.dbName, { name: user.name || user.dbName, dbName: user.dbName, apiKey: user.apiKey });
    }
  }
  return [...byDb.values()];
}

async function pull() {
  const perStore = Number(flag('per-store', 150));
  const minTraffic = Number(flag('min-traffic', 200));

  const client = await mongo();
  const accounts = await storeAccounts(client);
  const stores = [];

  for (const account of accounts) {
    const queries = client.db(account.dbName).collection('queries');
    const traffic = await queries.estimatedDocumentCount().catch(() => 0);
    if (traffic < minTraffic) continue;

    // Frequency order: the queries most shoppers actually type are the ones a
    // regression would hurt most.
    const top = await queries.aggregate([
      { $match: { query: { $type: 'string', $ne: '' } } },
      { $group: { _id: '$query', hits: { $sum: 1 } } },
      { $sort: { hits: -1 } },
      { $limit: perStore }
    ], { allowDiskUse: true }).toArray().catch(() => []);

    if (top.length === 0) continue;

    stores.push({
      name: account.name,
      dbName: account.dbName,
      traffic,
      queries: top.map(t => t._id.trim()).filter(Boolean)
    });
    console.log(`${account.dbName.padEnd(26)} ${String(traffic).padStart(7)} logged → ${top.length} queries`);
  }

  await client.close();

  mkdirSync(EVAL_DIR, { recursive: true });
  writeFileSync(CORPUS_PATH, JSON.stringify({ pulledAt: new Date().toISOString(), stores }, null, 1));
  const total = stores.reduce((n, s) => n + s.queries.length, 0);
  console.log(`\n${total} queries across ${stores.length} stores → ${CORPUS_PATH}`);
}

/* ------------------------------------------------------------------- run */

async function probe(url, apiKey, query, timeoutMs) {
  const abort = AbortSignal.timeout(timeoutMs);
  const res = await fetch(`${url}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ query, modern: true }),
    signal: abort
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const products = Array.isArray(data) ? data : (data.products || []);
  return {
    mode: data.metadata?.searchMode ?? null,
    count: products.length,
    // Product ids beat names: a renamed product is not a ranking change.
    ids: products.slice(0, 10).map(p => p.id ?? p._id ?? null)
  };
}

// Repeats inside a single pass only catch paths that are random per call. The
// translation and embedding variance that actually moves results is per
// process, and is caught by comparing passes in `diff`.
async function probeRepeatedly(url, apiKey, query, repeat, timeoutMs) {
  const observations = [];
  for (let i = 0; i < repeat; i++) {
    try {
      observations.push(await probe(url, apiKey, query, timeoutMs));
    } catch (err) {
      return { error: err.message, selfConsistent: false };
    }
  }
  const fingerprints = new Set(observations.map(o => JSON.stringify(o)));
  return { ...observations[0], selfConsistent: fingerprints.size === 1 };
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function run() {
  const label = flag('label');
  if (!label) throw new Error('run needs --label');
  const url = (flag('url', 'http://localhost:8099')).replace(/\/$/, '');
  const repeat = Number(flag('repeat', 1));
  const concurrency = Number(flag('concurrency', 4));
  const timeoutMs = Number(flag('timeout', 120000)) ;

  if (!existsSync(CORPUS_PATH)) throw new Error(`no corpus — run "pull" first`);
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));

  // Keys live in Mongo, never in the committed corpus.
  const client = await mongo();
  const keys = new Map((await storeAccounts(client)).map(a => [a.dbName, a.apiKey]));
  await client.close();

  // Narrowing keeps the loop tight while iterating on one store; a verdict run
  // uses the whole corpus.
  const only = flag('stores') ? new Set(flag('stores').split(',')) : null;
  const perStore = flag('limit') ? Number(flag('limit')) : Infinity;

  const jobs = [];
  for (const store of corpus.stores) {
    if (only && !only.has(store.dbName)) continue;
    const apiKey = keys.get(store.dbName);
    if (!apiKey) {
      console.warn(`skipping ${store.dbName}: no api key`);
      continue;
    }
    for (const query of store.queries.slice(0, perStore)) {
      jobs.push({ store: store.dbName, apiKey, query });
    }
  }

  console.log(`${label}: ${jobs.length} queries × ${repeat} repeats against ${url}`);
  let done = 0;
  const results = await pool(jobs, concurrency, async (job) => {
    const outcome = await probeRepeatedly(url, job.apiKey, job.query, repeat, timeoutMs);
    done++;
    if (done % 25 === 0) process.stdout.write(`  ${done}/${jobs.length}\r`);
    return { store: job.store, query: job.query, ...outcome };
  });

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const path = join(SNAPSHOT_DIR, `${label}.json`);
  writeFileSync(path, JSON.stringify({ label, url, repeat, recordedAt: new Date().toISOString(), results }, null, 1));

  const failed = results.filter(r => r.error).length;
  console.log(`\n${results.length} queries → ${path}`);
  if (repeat > 1) {
    console.log(`  inconsistent within the pass: ${results.filter(r => !r.selfConsistent && !r.error).length}`);
  }
  console.log(`  errored: ${failed}`);
}

/* ------------------------------------------------------------------ diff */

const overlap = (a = [], b = []) => {
  const setB = new Set(b);
  const shared = a.filter(id => setB.has(id)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : shared / union;
};

const fingerprint = (obs) => JSON.stringify({ mode: obs.mode, count: obs.count, ids: obs.ids });

// Collapses one build's passes into a per-query view: the outcome it produced,
// and whether it produced the same one every time.
function collapse(labels) {
  const byQuery = new Map();
  for (const label of labels) {
    const snapshot = JSON.parse(readFileSync(join(SNAPSHOT_DIR, `${label}.json`), 'utf8'));
    for (const result of snapshot.results) {
      const key = `${result.store}|${result.query}`;
      if (!byQuery.has(key)) {
        byQuery.set(key, { store: result.store, query: result.query, passes: [] });
      }
      byQuery.get(key).passes.push(result);
    }
  }

  for (const entry of byQuery.values()) {
    entry.errored = entry.passes.some(p => p.error);
    const prints = new Set(entry.passes.map(fingerprint));
    entry.stable = !entry.errored && prints.size === 1 && entry.passes.every(p => p.selfConsistent !== false);
    entry.observed = entry.passes[0];
    entry.spread = [...new Set(entry.passes.map(p => `${p.mode}/n=${p.count}`))];
  }
  return byQuery;
}

function diff() {
  const [baseArg, candArg] = args.filter(a => !a.startsWith('--'));
  if (!baseArg || !candArg) throw new Error('diff needs two comma-separated label groups');

  const baseLabels = baseArg.split(',');
  const candLabels = candArg.split(',');
  if (baseLabels.length < 2 || candLabels.length < 2) {
    console.warn('warning: fewer than 2 passes per build — noise cannot be separated from change\n');
  }

  const before = collapse(baseLabels);
  const after = collapse(candLabels);

  const buckets = { unchanged: [], noisy: [], changed: [], errored: [] };

  let compared = 0;
  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a) continue;   // a narrowed run compares only the stores it covered
    compared++;
    if (b.errored || a.errored) { buckets.errored.push({ b, a }); continue; }
    // A build contradicting its own passes makes the pair unreadable, not changed.
    if (!b.stable || !a.stable) { buckets.noisy.push({ b, a }); continue; }
    const identical = fingerprint(b.observed) === fingerprint(a.observed);
    (identical ? buckets.unchanged : buckets.changed).push({ b, a });
  }

  console.log(`\n[${baseLabels.join(' ')}] → [${candLabels.join(' ')}]   ${compared} queries\n`);
  console.log(`  unchanged        ${String(buckets.unchanged.length).padStart(5)}`);
  console.log(`  changed          ${String(buckets.changed.length).padStart(5)}   ← review these`);
  console.log(`  unstable (noise) ${String(buckets.noisy.length).padStart(5)}   ← a build disagrees with its own passes`);
  console.log(`  errored          ${String(buckets.errored.length).padStart(5)}`);

  if (buckets.changed.length > 0) {
    console.log(`\nCHANGED\n`);
    const sorted = buckets.changed
      .map(pair => ({ ...pair, similarity: overlap(pair.b.observed.ids, pair.a.observed.ids) }))
      .sort((x, y) => x.similarity - y.similarity);

    for (const { b, a, similarity } of sorted) {
      const moved = b.observed.mode === a.observed.mode
        ? b.observed.mode
        : `${b.observed.mode} → ${a.observed.mode}`;
      console.log(`  ${b.store.padEnd(24)} ${b.query}`);
      console.log(`      ${moved}   n: ${b.observed.count} → ${a.observed.count}   top-10 overlap: ${(similarity * 100).toFixed(0)}%`);
    }
  }

  if (buckets.noisy.length > 0) {
    console.log(`\nUNSTABLE (excluded from the verdict)\n`);
    for (const { b, a } of buckets.noisy) {
      console.log(`  ${b.store.padEnd(24)} ${b.query.padEnd(22)} before: ${b.spread.join(' ')}   after: ${a.spread.join(' ')}`);
    }
  }
}

/* ------------------------------------------------------------------ main */

const command = process.argv[2];
const commands = { pull, run, diff };
if (!commands[command]) {
  console.error('usage: search-eval.mjs <pull|run|diff> [options]');
  process.exit(1);
}
await commands[command]();
