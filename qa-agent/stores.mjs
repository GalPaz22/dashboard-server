// Discovers the stores the QA agent should test: active accounts that have
// credentials and an apiKey (so the live /search endpoint can authenticate).
import { getClient } from "./db.mjs";
import { config } from "./config.mjs";

/**
 * @returns {Promise<Array<{apiKey,dbName,name,context,credentials,syncMode}>>}
 */
export async function getActiveStores({ only = null } = {}) {
  const client = await getClient();
  const coll = client.db(config.usersDb).collection(config.usersCollection);

  const filter = {
    active: true,
    credentials: { $exists: true },
    apiKey: { $exists: true, $ne: null },
    dbName: { $exists: true, $ne: null },
  };

  const docs = await coll
    .find(filter)
    .project({ apiKey: 1, dbName: 1, name: 1, context: 1, credentials: 1, syncMode: 1 })
    .toArray();

  let stores = docs.map((d) => ({
    apiKey: d.apiKey,
    dbName: d.dbName,
    name: d.name || d.dbName,
    context: d.context || "",
    credentials: d.credentials || {},
    syncMode: d.syncMode || "text",
  }));

  if (only && only.length) {
    const wanted = new Set(only.map((s) => s.toLowerCase()));
    stores = stores.filter((s) => wanted.has(String(s.dbName).toLowerCase()));
  }

  return stores;
}

/**
 * A compact, human/LLM-readable view of the store's own taxonomy. This is the
 * ONLY domain knowledge fed to the judge — it comes entirely from the store's
 * own credentials, never from hardcoded constants.
 */
export function storeTaxonomy(store) {
  const c = store.credentials || {};
  const asList = (v) =>
    Array.isArray(v) ? v : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return {
    context: store.context || "",
    categories: asList(c.categories),
    types: asList(c.type),
    softCategories: asList(c.softCategories),
    colors: asList(c.colors),
  };
}
