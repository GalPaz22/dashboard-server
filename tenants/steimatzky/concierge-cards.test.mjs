import test from 'node:test';
import assert from 'node:assert/strict';
import {namedInReply} from './concierge-cards.mjs';
import {runAgent} from '../../concierge.mjs';

const p = (id, name) => ({product_id: id, name});
const shelf = [p('billionaire', 'איך להציל מיליארדר 3'), p('mind', 'לחשוב כמו מיליונר'), p('goal', 'המטרה'), p('leader', 'ON LEADERSHIP : LESSONS FOR THE 21ST CENTURY'),
  p('games', 'משחקי הרעב'), p('mocking', 'משחקי הרעב התפוח המורד'), p('game', 'תפוס ת׳לשון משחק'), p('talk', 'סיפור אהבה'), p('hand', 'יד')];
const ids = (reply, opts) => namedInReply(reply, shelf, opts);

test('quoted titles are found, in the order the reply names them', () => {
  assert.deepEqual(ids('שווה להכיר את "לחשוב כמו מיליונר" מאת הארב אקר, או את ״איך להציל מיליארדר 3״.'), ['mind', 'billionaire']);
  assert.deepEqual(ids('אפשר לבחור במתח "המטרה" (79 ש״ח) או *On Leadership* של טוני בלייר.'), ['goal', 'leader']);
  assert.deepEqual(ids('או את "תפוס ת׳לשון".'), ['game']);
  assert.deepEqual(ids('שווה להכיר את לחשוב כמו מיליונר.'), ['mind']);
});

test('ordinary words are not titles, and a longer title is not read as its shorter one', () => {
  assert.deepEqual(ids('המטרה שלי היא למצוא לך יד קלה וסיפור אהבה טוב. איזה סגנון?'), []);
  assert.deepEqual(ids('הנה "משחקי הרעב התפוח המורד".'), ['mocking']);
  assert.deepEqual(ids('אפשר לספר איזה ז׳אנר מעניין?'), []);
  assert.deepEqual(namedInReply('יש ספרים שמתחילים במילים ״להציל את״.', [p('m', 'להציל את מדלן')]), []);
});

test('a book the shopper already has is not shown back', () => {
  const reply = 'אם אהבתם את "משחקי הרעב", שווה להכיר את "לחשוב כמו מיליונר".';
  assert.deepEqual(ids(reply), ['games', 'mind']);
  assert.deepEqual(ids(reply, {asked: 'משהו דומה למשחקי הרעב'}), ['mind']);
  assert.deepEqual(ids(reply, {asked: 'קראתי את משחקי הרעב'}), ['mind']);
});

test('a name said shorter than the catalog writes it', () => {
  const rows = [p('seq', 'משחקי הרעב התפוח המורד'), p('one', 'משחקי הרעב 1 מהדורה חדשה 2020'), p('goal', "המטרה/ דיוויד באלדאצ’י"),
    p('three', 'שלוש שניות 5 שלוש שנים'), p('fear', 'ג’ק טיילור 4 פ’ זה פחד'), p('love', 'חמלה רדיקלית -כריכה רכה')];
  assert.deepEqual(namedInReply('"משחקי הרעב", "המטרה", "שלוש שנים", "פ\' זה פחד" ו"חמלה רדיקלית".', rows), ['one', 'goal', 'three', 'fear', 'love']);
  assert.deepEqual(namedInReply('אם אהבתם את "משחקי הרעב", שווה להכיר את "המטרה".', rows, {asked: 'משהו דומה למשחקי הרעב'}), ['goal']);
  assert.deepEqual(namedInReply('המטרה היא לעבור שלוש שנים. איזה סגנון?', [rows[2]]), []);
});

const doc = (id, extra = {}) => ({id, name: id === 'mind' ? 'לחשוב כמו מיליונר' : 'המטרה', price: 50, stockStatus: 'instock', url: `https://www.steimatzky.co.il/${id}`, ...extra});
const turn = async ({docs, text, message = '', shown = [shelf[1], shelf[2]], calls = []}) => {
  const ctx = {store: {dbName: 'steimatzky', products: 'products'}, message, trigger: {reason: 'alternatives', query: 'איך להציל מיליונר'}, shown: new Map(shown.map(b => [b.product_id, b])),
    deps: {getMongoClient: async () => ({db: () => ({collection: () => ({find: () => ({toArray: async () => docs})})})})}};
  const events = [];
  const modelClient = {models: {async generateContentStream() { calls.push(1); return (async function*() { yield {candidates: [{content: {parts: [{text}]}, finishReason: 'STOP'}]}; })(); }}};
  await runAgent({messages: [{role: 'user', parts: [{text: 'פתיחה'}]}], ctx, onEvent: e => events.push(e), modelClient});
  return events;
};

test('a reply that names books ends with their cards, without another model round', async () => {
  const calls = [];
  const events = await turn({docs: [doc('mind'), doc('goal')], text: 'שווה להכיר את "לחשוב כמו מיליונר" או את "המטרה".', calls});
  const shown = events.find(e => e.type === 'tool_end');
  assert.deepEqual(shown.products.map(b => b.product_id), ['mind', 'goal']);
  assert.equal(calls.length, 1);
  assert.equal(events.at(-1).type, 'done');
});

test('a sold-out book among them does not hide the rest, and a question shows nothing', async () => {
  const events = await turn({docs: [doc('mind', {stockStatus: 'outofstock'}), doc('goal')], text: 'שווה להכיר את "לחשוב כמו מיליונר" או את "המטרה".'});
  assert.deepEqual(events.find(e => e.type === 'tool_end').products.map(b => b.product_id), ['goal']);
  const none = await turn({docs: [doc('mind')], text: 'איזה ז׳אנר מעניין אותך?'});
  assert.equal(none.some(e => e.type === 'tool_end'), false);
});

test('no cards when the shopper refused alternatives', async () => {
  const events = await turn({docs: [doc('mind')], text: 'לצערי אזל. אולי "לחשוב כמו מיליונר"?', message: 'בלי חלופות בבקשה'});
  assert.equal(events.some(e => e.type === 'tool_end'), false);
});
