// Shopper authentication stays in server.js. Read only the authenticated store's
// prompt fields on each new turn, outside its five-minute store-config cache.
export async function liveConciergeSettings(store, getMongoClient) {
  const client = await getMongoClient();
  const accounts = await client.db('users').collection('users').find({ dbName: store.dbName }, { projection: {
    platform: 1, conciergeInstructions: 1, conciergeContext: 1, conciergeSystemPrompt: 1,
    'credentials.dbName': 1, 'credentials.conciergeInstructions': 1, 'credentials.conciergeContext': 1, 'credentials.conciergeSystemPrompt': 1,
  } }).sort({ _id: 1 }).toArray();
  const users = accounts.filter(user => !user.credentials?.dbName || user.credentials.dbName === store.dbName);
  const primary = users.find(user => user.platform) || users[0];
  if (!primary) return store;
  const value = key => typeof primary[key] === 'string' ? primary[key] : typeof primary.credentials?.[key] === 'string' ? primary.credentials[key] : '';
  return { ...store, conciergeInstructions: value('conciergeInstructions'), conciergeContext: value('conciergeContext'), conciergeSystemPrompt: value('conciergeSystemPrompt') || null };
}
