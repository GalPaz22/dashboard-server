// Saved dashboard layouts are Mongo state. They must keep working when Studio
// cannot reach the search server's Redis, or its 120-second publication expires.
export function createPermanentRuleLoader({ now = Date.now, ttlMs = 15_000, maxEntries = 500 } = {}) {
  const cache = new Map();
  return async function load(store, client) {
    const key = JSON.stringify([store.dbName, store.apiKey]);
    const cached = cache.get(key);
    if (cached?.pending) return cached.pending;
    if (cached && now() - cached.at < ttlMs) return cached.rules;
    const entry = {};
    const pending = (async () => {
      const siblings = await client.db('users').collection('users').find(
        { dbName: store.dbName }, { projection: { apiKey: 1 }, maxTimeMS: 2000 }
      ).toArray();
      const keys = [...new Set([store.apiKey, ...siblings.map(row => row.apiKey)].filter(Boolean))];
      const rows = await client.db('control_plane').collection('rules').find({
        status: 'active',
        $or: [
          { dbName: store.dbName },
          // Legacy rules have only a service key. An explicit other dbName
          // must never become ours merely because a key matches.
          { dbName: { $exists: false }, tenantApiKey: { $in: keys } },
        ],
      }, { projection: { condition: 1, patch: 1, merchantQuery: 1 }, maxTimeMS: 2000 })
        .sort({ updatedAt: 1, createdAt: 1, _id: 1 }).limit(501).toArray();
      if (rows.length > 500) throw Error('Too many active store rules');
      // The merchant's saved arrangement takes precedence over older agent pins.
      rows.sort((a, b) => Number(typeof a.merchantQuery === 'string') - Number(typeof b.merchantQuery === 'string'));
      const rules = rows.map(row => ({ id: String(row._id), condition: row.condition, patch: row.patch }));
      entry.rules = rules;
      entry.at = now();
      delete entry.pending;
      return rules;
    })().catch(error => { cache.delete(key); throw error; });
    entry.pending = pending;
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return pending;
  };
}
