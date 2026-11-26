// One back-in-stock pass by hand. Reads only, unless --write is given.
//   node restock-watch-run.mjs garmin            what would be watched
//   node restock-watch-run.mjs garmin --write    save the watches and the profile flags
import "dotenv/config";
import { MongoClient } from "mongodb";
import { runRestockWatch } from "./restock-watch.mjs";

const stores = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const write = process.argv.includes("--write");
if (!stores.length) {
  console.error("usage: node restock-watch-run.mjs <dbName> [...] [--write]");
  process.exit(1);
}

const client = await new MongoClient(process.env.MONGODB_URI, write ? {} : { readPreference: "secondaryPreferred" }).connect();
try {
  for (const store of stores) {
    const db = client.db(store);
    const { found, ...summary } = await runRestockWatch(db, { dryRun: !write });
    console.log(store, JSON.stringify(summary));
    if (!found) continue;
    // Search words and product names only: no customer details are printed.
    const byQuery = new Map();
    for (const f of found) {
      const entry = byQuery.get(f.query) || { sessions: new Set(), products: new Set() };
      entry.sessions.add(f.session_id);
      entry.products.add(f.product.name);
      byQuery.set(f.query, entry);
    }
    for (const [query, e] of [...byQuery].sort((a, b) => b[1].sessions.size - a[1].sessions.size).slice(0, 25)) {
      console.log(`  ${e.sessions.size} × "${query}" → ${[...e.products].slice(0, 2).join(" | ")}`);
    }
  }
} finally {
  await client.close();
}
