import test from 'node:test';
import assert from 'node:assert/strict';
import {conciergeRolloutOpen, isSteimatzky, shownBooks, soldOutNamed, worthClassifying} from './concierge.mjs';
import {buildSystemPrompt, conciergeModelConfig, decideMoment} from '../../concierge.mjs';

const instock = (title, author = '') => ({title, author, inStock: true});
const sold = (name, extra = {}) => ({name, price: 70, stockStatus: 'outofstock', ...extra});

test('a sold-out book counts only when the search names it and nothing in stock answers it', () => {
  assert.equal(soldOutNamed('אבן החכמים', [], [sold('הארי פוטר ואבן החכמים')]).length, 1);
  assert.equal(soldOutNamed('אבן החכמים', [instock('הארי פוטר ואבן החכמים - ספר דיגיטלי')], [sold('הארי פוטר ואבן החכמים')]).length, 0);
  assert.equal(soldOutNamed('ספרי בישול', [], [sold('ספרי בישול לילדים בגיל הרך')]).length, 0);
  assert.equal(soldOutNamed('בישול ים תיכוני', [], [sold('בישול ים תיכוני', {price: 0})]).length, 0, 'retired row');
  assert.equal(soldOutNamed('בישול ים תיכוני', [], [sold('בישול ים תיכוני', {notInStore: true})]).length, 0, 'not in store');
});

test('the same words in another spelling of punctuation still name the book', () => {
  assert.equal(soldOutNamed("צ'רלי ומפעל השוקולד", [], [sold('צרלי ומפעל השוקולד')]).length, 1);
});

test('only advice-shaped searches reach the model', () => {
  assert.equal(worthClassifying('הארי פוטר', []), false);
  assert.equal(worthClassifying('ספר לילד בן 8', []), true);
  assert.equal(worthClassifying('מתנה לאמא', []), true);
  assert.equal(worthClassifying('המלצה?', []), true);
  assert.equal(worthClassifying('הארי פוטר ואבן החכמים', [instock('הארי פוטר ואבן החכמים')]), false, 'a title on screen');
  assert.equal(worthClassifying('יובל נח הררי קיצור', [instock('קיצור תולדות האנושות', 'יובל נח הררי')]), false, 'title and author on screen');
});

test('rollout: off, one visitor, everyone', () => {
  assert.equal(conciergeRolloutOpen({}, 'a'), false);
  assert.equal(conciergeRolloutOpen({conciergeRollout: {visitors: ['a']}}, 'a'), true);
  assert.equal(conciergeRolloutOpen({conciergeRollout: {visitors: ['a']}}, 'b'), false);
  assert.equal(conciergeRolloutOpen({conciergeRollout: {enabled: true}}, 'b'), true);
});

test('shown books are capped and typed', () => {
  const list = shownBooks(Array.from({length: 40}, (_, i) => ({id: i, title: 't', inStock: 'yes'})));
  assert.equal(list.length, 24);
  assert.equal(list[0].inStock, false);
  assert.deepEqual(shownBooks('x'), []);
});

// A catalog stand-in: decideMoment reads products only through this collection.
function ctxWith(rows) {
  const collection = {aggregate: () => ({toArray: async () => rows})};
  return {store: {dbName: 'steimatzky', products: 'products'}, deps: {getMongoClient: async () => ({db: () => ({collection: () => collection})}), getRedis: () => null}};
}

test('the three moments, in order', async () => {
  const shown = [instock('ספר אחר')];
  assert.equal((await decideMoment({query: 'אבן החכמים', repeats: 3, shown, ctx: ctxWith([sold('הארי פוטר ואבן החכמים', {id: 7})])})).reason, 'out_of_stock');
  assert.equal((await decideMoment({query: 'פוטר', repeats: 3, shown, ctx: ctxWith([])})).reason, 'repeated');
  assert.equal(await decideMoment({query: 'פוטר', repeats: 2, shown, ctx: ctxWith([])}), null);
});

test('closest alternatives on screen open the concierge, after a named sold-out book', async () => {
  const shown = [{...instock('קטאן'), id: 'g1'}, {...instock('דוביל'), id: 'g2'}];
  const r = await decideMoment({query: 'שם קוד דואט', repeats: 0, shown, alternatives: true, ctx: ctxWith([])});
  assert.deepEqual(r, {reason: 'alternatives', product_ids: ['g1', 'g2']});
  assert.equal((await decideMoment({query: 'אבן החכמים', repeats: 0, shown, alternatives: true, ctx: ctxWith([sold('הארי פוטר ואבן החכמים', {id: 7})])})).reason, 'out_of_stock');
});

test('an in-stock edition found in the catalog stops the sold-out moment', async () => {
  const rows = [sold('הארי פוטר ואבן החכמים', {id: 7}), {name: 'הארי פוטר ואבן החכמים', id: 8, price: 60, stockStatus: 'instock'}];
  assert.equal(await decideMoment({query: 'אבן החכמים', repeats: 0, shown: [], ctx: ctxWith(rows)}), null);
});

test('Steimatzky runs on Flash-Lite low and gets the bookstore instructions', () => {
  const store = {dbName: 'steimatzky'};
  assert.ok(isSteimatzky(store));
  assert.deepEqual(conciergeModelConfig(store), {model: 'gemini-3.5-flash-lite', thinkingLevel: 'LOW'});
  assert.match(buildSystemPrompt(store), /יועץ הספרים של סטימצקי/);
  assert.doesNotMatch(buildSystemPrompt({dbName: 'garmin'}), /סטימצקי/);
});

test('the bookstore prompt keeps the answer in Hebrew prose', () => {
  const prompt = buildSystemPrompt({dbName: 'steimatzky'});
  assert.match(prompt, /אותיות עבריות בלבד/);
  assert.match(prompt, /בלי רשימות/);
});

test('the prompt mirrors the shopper\'s gender and never assumes male', () => {
  const prompt = buildSystemPrompt({dbName: 'steimatzky'});
  assert.ok(!prompt.includes('בלשון זכר יחיד'));
  assert.match(prompt, /בלשון נקבה/);
  assert.match(prompt, /שאמר שקרא/);
});
