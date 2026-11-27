import test from 'node:test';
import assert from 'node:assert/strict';
import {prefetchOpeningSearch, presentProducts, runAgent} from '../../concierge.mjs';
import {similarGames, storeHoldsName} from './concierge-missing.mjs';
import {steimatzkyTurnPolicy} from './concierge-response-policy.mjs';

const game = (id, name, description = '', extra = {}) => ({id, name, description, price: 70, stockStatus: 'instock', productTypes: ['משחקים פאזלים וקלפים'], ...extra});
const book = (id, name, author = '') => ({id, name, author, price: 40, stockStatus: 'instock', productTypes: ['סיפורת']});
const shelf = [
  game('dog', 'תפוס ת׳לשון', 'הכלבלבים ליקקו את הסוכריות'),
  game('bone', 'עד העצם', 'להשיג הכי הרבה עצמות'),
  game('words', 'מילים בעיגולים', 'משחק ארץ עיר'),
  game('gone', 'כלב מופתע', '', {pageCheck: {status: 404}}),
  game('noprice', 'כלב ועצם', '', {price: {value: 50}}),
  {id: 'glasses', name: 'משקפי קריאה', price: 50, stockStatus: 'instock', productTypes: ['מוצרי פנאי']},
];
const dig = {kind: 'game', about: 'משחק על כלב שחופר', subject: ['כלב', 'עצם', 'חפירה'], style: ['זריזות']};

function ctxWith({found = [], product = dig, trigger}) {
  const calls = [];
  const collection = {
    aggregate: () => ({toArray: async () => found}),
    find: () => ({toArray: async () => shelf}),
  };
  const ctx = {store: {dbName: 'steimatzky', products: 'products'}, trigger, deps: {
    getMongoClient: async () => ({db: () => ({collection: () => collection})}),
    getQueryEmbedding: async () => null,
    identifyProduct: async q => { calls.push(q); return product; },
  }};
  return {ctx, calls};
}

test('a product holding every searched word means the store has the name', () => {
  assert.equal(storeHoldsName('חפר הכלב החופר', [book(1, 'רצוא ושוב', 'לילה מאיה חפר'), book(2, 'איש הכלב')]), false);
  assert.equal(storeHoldsName('הילד והדב', [book(1, 'הילד והדב')]), true);
  assert.equal(storeHoldsName('משחק קופסה קטאן', [game(1, 'קטאן')]), true);
});

test('similar games hold the themes, are playable and can be bought', () => {
  assert.deepEqual(similarGames(shelf, dig).map(p => p.id).sort(), ['bone', 'dog']);
  assert.deepEqual(similarGames(shelf, {kind: 'game'}), []);
});

test('a theme finds plurals and diminutives, not any longer word', () => {
  const rows = [game('puppy', 'לשון', 'הכלבלבים ליקקו'), game('bones', 'קלפים', 'אספו עצמות'), game('causes', 'דומינו', 'מפולת שגורמת לתנועה, גורם')];
  assert.deepEqual(similarGames(rows, {kind: 'game', subject: ['כלב', 'עצם', 'גור']}).map(p => p.id).sort(), ['bones', 'puppy']);
});

test('the subject outranks the play style, and a jigsaw is not offered for a game', () => {
  const rows = [game('quick', 'קופץ בראש', 'משחק זריזות'), game('dog', 'לשון', 'הכלבלבים ליקקו'), game('jigsaw', 'כלבים בשלג פאזל 300 חלקים')];
  assert.deepEqual(similarGames(rows, dig).map(p => p.id), ['dog', 'quick']);
});

test('a missing game opens with games and only they can be shown', async () => {
  const trigger = {query: 'חפר הכלב החופר', reason: 'alternatives'};
  const {ctx} = ctxWith({found: [book('b', 'רצוא ושוב', 'לילה מאיה חפר')], trigger});
  const result = await prefetchOpeningSearch(trigger, ctx);
  assert.equal(result.not_carried.kind, 'game');
  // A price stored as {value} is read as the price it is.
  assert.deepEqual(result.similar.map(p => p.product_id).sort(), ['bone', 'dog', 'noprice']);
  assert.equal(result.similar.find(p => p.product_id === 'noprice').price, 50);
  const policy = steimatzkyTurnPolicy(ctx.store, {trigger, message: ''});
  ctx.shown = new Map([['b', {}], ['dog', {}]]);
  ctx.responsePolicy = policy;
  ctx.deps.getMongoClient = async () => ({db: () => ({collection: () => ({find: () => ({toArray: async () => [book('b', 'רצוא ושוב'), shelf[0]]})})})});
  assert.deepEqual((await presentProducts({product_ids: ['b']}, ctx)).products, []);
  assert.deepEqual((await presentProducts({product_ids: ['dog']}, ctx)).products.map(p => p.product_id), ['dog']);
  assert.equal(steimatzkyTurnPolicy(ctx.store, {trigger, message: 'ואולי ספר על כלבים?'}).offered, null);
});

test('picks named in words only still come with their cards', async () => {
  const trigger = {query: 'חפר הכלב החופר', reason: 'alternatives'};
  const {ctx} = ctxWith({trigger});
  await prefetchOpeningSearch(trigger, ctx);
  ctx.message = '';
  ctx.shown = new Map([['dog', {product_id: 'dog', name: 'תפוס ת׳לשון משחק'}], ['bone', {product_id: 'bone', name: 'עד העצם'}]]);
  const events = [];
  const modelClient = {models: {async generateContentStream() { return (async function*() { yield {candidates: [{content: {parts: [{text: 'לא נמצא בחנות. שווה להכיר את "תפוס ת׳לשון".'}]}, finishReason: 'STOP'}]}; })(); }}};
  ctx.deps.getMongoClient = async () => ({db: () => ({collection: () => ({find: () => ({toArray: async () => [shelf[0]]})})})});
  await runAgent({messages: [{role: 'user', parts: [{text: 'פתיחה'}]}], ctx, onEvent: e => events.push(e), modelClient});
  assert.deepEqual(events.flatMap(e => e.products || []).map(p => p.product_id), ['dog']);
});

test('a missing book keeps the plain search', async () => {
  const trigger = {query: 'ספר שאין בחנות', reason: 'alternatives'};
  const {ctx} = ctxWith({found: [book('b', 'ספר אחר')], product: {kind: 'book', about: '', subject: [], style: []}, trigger});
  const result = await prefetchOpeningSearch(trigger, ctx);
  assert.equal(result.not_carried, undefined);
  assert.equal(trigger.offered_ids, undefined);
});

test('a name the store holds is not identified at all', async () => {
  const trigger = {query: 'עד העצם', reason: 'alternatives'};
  const {ctx, calls} = ctxWith({found: [shelf[1]], trigger});
  assert.equal((await prefetchOpeningSearch(trigger, ctx)).not_carried, undefined);
  assert.equal(calls.length, 0);
});
