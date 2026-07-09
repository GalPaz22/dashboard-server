#!/usr/bin/env node
// QA Agent orchestrator. Discovers active stores, builds a real query set per
// store, runs each query through the live search endpoint, grades the results,
// diagnoses a root-cause fix for every failure, and writes a report for review.
//
// This script NEVER writes to any store DB — it only reads and produces a report.
// Fixes are applied later, after your approval, by apply.mjs.
//
// Usage:
//   node qa-agent/run.mjs [--stores manoVino,garmin] [--limit 20]
import { config } from "./config.mjs";
import { getActiveStores } from "./stores.mjs";
import { buildQuerySet } from "./querySet.mjs";
import { healthCheck, runSearchBatch } from "./searchRunner.mjs";
import { grade, diagnoseAndFix } from "./judge.mjs";
import { makeRunDir, writeReport } from "./report.mjs";
import { closeClient } from "./db.mjs";

function parseArgs(argv) {
  const args = { stores: null, limit: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stores") args.stores = argv[++i]?.split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--limit") args.limit = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!(await healthCheck())) {
    console.error(`\n❌ Search server not reachable at ${config.baseUrl}.`);
    console.error(`   Start it first:  ./start-with-restart.sh   (or set QA_BASE_URL)\n`);
    process.exit(1);
  }

  const stores = await getActiveStores({ only: args.stores });
  if (!stores.length) {
    console.error("No active stores matched. Nothing to do.");
    await closeClient();
    process.exit(1);
  }
  console.log(`\n🔍 QA run over ${stores.length} store(s): ${stores.map((s) => s.dbName).join(", ")}\n`);

  const overrides = args.limit ? { cap: args.limit } : {};
  const storeReports = [];

  for (const store of stores) {
    process.stdout.write(`\n=== ${store.dbName} ===\n`);
    const cases = await buildQuerySet(store, overrides);
    if (!cases.length) {
      console.log(`  (no queries/products found — skipping)`);
      storeReports.push({ store, cases: [] });
      continue;
    }
    console.log(`  ${cases.length} test queries → running live search...`);

    const searched = await runSearchBatch(store, cases);

    const graded = [];
    for (const item of searched) {
      if (!item.result.ok) {
        graded.push({ ...item, grade: { verdict: "bad", score: 0, issues: [`search error: ${item.result.error}`], inferredIntent: null } });
        continue;
      }
      const g = await grade(store, item, item.result).catch((e) => ({ verdict: "unknown", issues: [String(e.message)] }));
      graded.push({ ...item, grade: g });
      const mark = g.verdict === "good" ? "✅" : g.verdict === "mediocre" ? "🟡" : g.verdict === "bad" ? "🔴" : "⚪";
      console.log(`  ${mark} [${g.verdict}${g.score != null ? " " + g.score : ""}] ${item.query}`);
    }

    // Diagnose only the failures (bad/mediocre) — the expensive step.
    for (const g of graded) {
      if (g.grade?.verdict === "bad" || g.grade?.verdict === "mediocre") {
        g.diagnosis = await diagnoseAndFix(store, g, g.result, g.grade).catch((e) => ({
          rootCause: `diagnosis error: ${e.message}`, lever: null, fix: null, confidence: 0,
        }));
        if (g.diagnosis?.lever) console.log(`     🔧 fix(${g.diagnosis.lever}) for "${g.query}"`);
      }
    }

    storeReports.push({ store, cases: graded });
  }

  const { dir } = makeRunDir();
  const json = writeReport(dir, storeReports);

  const totals = json.stores.reduce((a, s) => ({ good: a.good + s.good, mediocre: a.mediocre + s.mediocre, bad: a.bad + s.bad }), { good: 0, mediocre: 0, bad: 0 });
  console.log(`\n✅ Done. good:${totals.good} mediocre:${totals.mediocre} bad:${totals.bad} | ${json.fixes.length} proposed fixes`);
  console.log(`📄 Report:  ${dir}/report.md`);
  console.log(`🧾 JSON:    ${dir}/report.json\n`);

  await closeClient();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await closeClient();
  process.exit(1);
});
