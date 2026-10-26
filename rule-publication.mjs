import { createHash } from 'node:crypto';
import { refreshPermanentRules } from './experiments-hook.mjs';

// Re-read saved state through the same loader used by search. No merchant
// patch or store identity from the request body is accepted here.
export async function publishStoreRules({ store, client }) {
  if (!store?.dbName || !store?.apiKey) throw Object.assign(Error('Store authentication required'), { status: 401 });
  const state = await refreshPermanentRules(store, client);
  if (state.pinnedResults === undefined) throw Error('Store account not found');
  return { available: true, published: true, dbName: store.dbName, mode: 'search-mongo', propagationSeconds: 15,
    revision: createHash('sha256').update(JSON.stringify(state)).digest('hex') };
}
export function mountRulePublication(app, { getClient }) {
  app.post('/rules/publication', async (req, res) => {
    try {
      const result = await publishStoreRules({ store: req.store, client: await getClient() });
      res.set('cache-control', 'no-store').json(result);
    } catch (error) {
      res.status(error.status || 503).json({ error: 'לא ניתן לאמת את הפעלת הכללים בחיפוש כרגע' });
    }
  });
}
