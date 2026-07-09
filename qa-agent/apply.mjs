#!/usr/bin/env node
// Applies approved fixes from a report.json. Safe by default:
//   - dry-run unless --commit is passed
//   - only fixes with approved:true (or listed in --approve) are applied
//   - every write is preceded by a snapshot into backup.json (revert-able)
//   - idempotent: already-applied fixes are skipped
//   - "algorithm" fixes are NEVER auto-applied — printed as manual TODOs
//
// Usage:
//   node qa-agent/apply.mjs <report.json> [--approve id1,id2 | --all-approved] [--commit]
import fs from "fs";
import path from "path";
import { getClient, closeClient } from "./db.mjs";
import { config } from "./config.mjs";

function parseArgs(argv) {
  const args = { reportPath: null, approve: null, allApproved: false, commit: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--approve") args.approve = new Set(argv[++i]?.split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--all-approved") args.allApproved = true;
    else if (a === "--commit") args.commit = true;
    else if (!a.startsWith("--")) args.reportPath = a;
  }
  return args;
}

function isApproved(fix, args) {
  if (args.approve) return args.approve.has(fix.id);
  if (args.allApproved) return fix.approved === true;
  return fix.approved === true;
}

const asList = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

async function main() {
  const args = parseArgs(process.argv);
  if (!args.reportPath || !fs.existsSync(args.reportPath)) {
    console.error("Usage: node qa-agent/apply.mjs <report.json> [--approve id1,id2 | --all-approved] [--commit]");
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(args.reportPath, "utf8"));
  const dir = path.dirname(args.reportPath);
  const backupPath = path.join(dir, "backup.json");
  const backups = fs.existsSync(backupPath) ? JSON.parse(fs.readFileSync(backupPath, "utf8")) : [];

  const selected = report.fixes.filter((f) => isApproved(f, args) && !f.applied);
  if (!selected.length) {
    console.log("No approved, un-applied fixes to process.");
    process.exit(0);
  }

  console.log(`\n${args.commit ? "🟢 COMMIT" : "🧪 DRY-RUN"} — ${selected.length} fix(es) selected\n`);
  const client = await getClient();

  for (const fix of selected) {
    console.log(`— ${fix.id} [${fix.lever}] "${fix.query}" (${fix.store})`);
    try {
      if (fix.lever === "algorithm") {
        console.log(`  ⚠️  ALGORITHM change — not auto-applied. Manual TODO in server.js:`);
        console.log(`      ${fix.fix?.description || fix.rootCause}`);
        continue;
      }

      const change = await buildChange(client, report, fix);
      if (!change) {
        console.log("  (skipped — nothing to change / already satisfied)");
        continue;
      }
      console.log(`  target: ${change.desc}`);
      console.log(`  before: ${JSON.stringify(change.before)}`);
      console.log(`  after:  ${JSON.stringify(change.after)}`);

      if (args.commit) {
        backups.push({ id: fix.id, at: new Date().toISOString(), ...change.backup });
        fs.writeFileSync(backupPath, JSON.stringify(backups, null, 2), "utf8");
        await change.write();
        fix.applied = true;
        fix.appliedAt = new Date().toISOString();
        console.log("  ✅ applied");
      } else {
        console.log("  (dry-run — not written)");
      }
    } catch (e) {
      console.error(`  ❌ failed: ${e.message}`);
    }
    console.log("");
  }

  if (args.commit) {
    fs.writeFileSync(args.reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`Backups: ${backupPath}`);
    console.log("Note: store-config cache (server.js) has a 5-min TTL — changes take effect within ~5 minutes.");
  } else {
    console.log("Re-run with --commit to apply.");
  }
  await closeClient();
}

// Returns { desc, before, after, backup, write() } or null.
async function buildChange(client, report, fix) {
  const usersColl = client.db(config.usersDb).collection(config.usersCollection);
  const apiKey = fix.apiKey;

  if (fix.lever === "context_rule") {
    const appendText = fix.fix?.appendText?.trim();
    if (!appendText) return null;
    const user = await usersColl.findOne({ apiKey }, { projection: { context: 1 } });
    const before = user?.context || "";
    if (before.includes(appendText)) return null; // idempotent
    const after = before ? `${before.trim()}. ${appendText}` : appendText;
    return {
      desc: `users.users.context (${fix.store})`,
      before, after,
      backup: { scope: "users.context", apiKey, previous: before },
      write: () => usersColl.updateOne({ apiKey }, { $set: { context: after } }),
    };
  }

  if (fix.lever === "config_change") {
    const field = fix.fix?.field;
    const op = fix.fix?.op;
    const value = fix.fix?.value;
    const allowed = ["softCategories", "categories", "type", "colors", "softCategoryBoosts"];
    if (!allowed.includes(field)) throw new Error(`config field not allowed: ${field}`);
    const user = await usersColl.findOne({ apiKey }, { projection: { credentials: 1 } });
    const cred = user?.credentials || {};
    const key = `credentials.${field}`;

    if (field === "softCategoryBoosts" || op === "setBoost") {
      const before = cred.softCategoryBoosts || {};
      const after = { ...before, ...(typeof value === "object" ? value : {}) };
      return {
        desc: `credentials.softCategoryBoosts (${fix.store})`,
        before, after,
        backup: { scope: key, apiKey, previous: before },
        write: () => usersColl.updateOne({ apiKey }, { $set: { "credentials.softCategoryBoosts": after } }),
      };
    }

    const before = asList(cred[field]);
    const vals = asList(value);
    let after;
    if (op === "add") {
      after = Array.from(new Set([...before, ...vals]));
      if (after.length === before.length) return null; // nothing new
    } else if (op === "remove") {
      const rm = new Set(vals);
      after = before.filter((x) => !rm.has(x));
      if (after.length === before.length) return null;
    } else {
      throw new Error(`unknown config op: ${op}`);
    }
    return {
      desc: `${key} (${fix.store})`,
      before, after,
      backup: { scope: key, apiKey, previous: before },
      write: () => usersColl.updateOne({ apiKey }, { $set: { [key]: after } }),
    };
  }

  if (fix.lever === "product_retag") {
    const products = Array.isArray(fix.fix?.products) ? fix.fix.products : [];
    if (!products.length) return null;
    const coll = client.db(fix.store).collection("products");

    const ops = [];
    const backupProducts = [];
    for (const p of products) {
      if (p.id == null || !p.set || typeof p.set !== "object") continue;
      const filter = { $or: [{ id: p.id }, { id: String(p.id) }, { ItemID: p.id }, { ItemID: String(p.id) }] };
      const current = await coll.findOne(filter, { projection: { id: 1, name: 1, Name: 1, category: 1, type: 1, softCategory: 1 } });
      if (!current) continue;
      const setDoc = {};
      for (const f of ["category", "type", "softCategory"]) {
        if (p.set[f] != null && p.set[f] !== current[f]) setDoc[f] = p.set[f];
      }
      if (!Object.keys(setDoc).length) continue;
      backupProducts.push({ filter, previous: { category: current.category, type: current.type, softCategory: current.softCategory } });
      ops.push({ filter, setDoc, name: current.name || current.Name });
    }
    if (!ops.length) return null;

    return {
      desc: `${fix.store}.products retag ×${ops.length}`,
      before: ops.map((o) => ({ id: o.filter.$or[0].id, name: o.name })),
      after: ops.map((o) => o.setDoc),
      backup: { scope: "products.retag", store: fix.store, products: backupProducts },
      write: async () => {
        for (const o of ops) await coll.updateOne(o.filter, { $set: o.setDoc });
      },
    };
  }

  throw new Error(`unknown lever: ${fix.lever}`);
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await closeClient();
  process.exit(1);
});
