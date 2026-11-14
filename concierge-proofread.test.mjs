import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFixes, parseFixes, proofreadReply} from './concierge-proofread.mjs';
import {dropPlanning} from './concierge.mjs';

const reply = 'איזה צבע תרדיף? יש לנו את fēnix 8 ב-3,449 ₪ ועם פנס מובנת, מתאימה לשוני Fenix.';

test('only broken words that are really in the reply are fixed, as whole words', () => {
  const fixes = parseFixes('תרדיף => תעדיף\nשוני => לשעוני\nלבן פנינה => תקין (שם מוצר)\nfēnix => פניקס\nלא קיים => משהו', reply);
  assert.deepEqual(fixes, [['תרדיף', 'תעדיף']]);
  assert.equal(applyFixes('מתאימה לשוני ושוני', [['שוני', 'X']]), 'מתאימה לשוני ושוני');
});

test('a fix may not touch numbers, Latin product names, or words the tools and the shopper wrote', () => {
  assert.deepEqual(parseFixes('3,449 => 3,500\nמובנת => מובנה', reply), [['מובנת', 'מובנה']]);
  assert.deepEqual(parseFixes('מובנת => מובנה', reply, 'פנס מובנת'), []);
});

test('a Hebrew word is fixed only when both readings name it; foreign letters on either reading', async () => {
  const readings = ['תרדיף => תעדיף\nמובנת => מובנה', 'תרדיף => תעדיף'];
  let i = 0;
  const checked = await proofreadReply(reply, {generate: async () => readings[i++ % 2]});
  assert.equal(checked.changed, true);
  assert.match(checked.text, /תעדיף/);
  assert.match(checked.text, /מובנת/);

  const glued = 'נשמח לעזור, מה תרzi לקנות?';
  let j = 0;
  const foreign = await proofreadReply(glued, {generate: async () => (j++ ? 'תקין' : 'תרzi => תרצי')});
  assert.equal(foreign.text, 'נשמח לעזור, מה תרצי לקנות?');
});

test('a timeout or an error keeps the reply as it was', async () => {
  const slow = await proofreadReply(reply, {timeoutMs: 20, generate: (text, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))});
  assert.deepEqual([slow.changed, slow.text, slow.error], [false, reply, 'timeout']);
  const failed = await proofreadReply(reply, {generate: async () => { throw new Error('quota'); }});
  assert.equal(failed.text, reply);
});

test('planning about "the customer" and tool talk never reach the shopper', () => {
  assert.equal(dropPlanning('הלקוח ביקש השוואה. אפעיל את `search_catalog` כדי למצוא. איזה שעונים תרצה להשוות?'), 'איזה שעונים תרצה להשוות?');
  assert.equal(dropPlanning('הנה שלושה שעונים מצוינים.'), 'הנה שלושה שעונים מצוינים.');
});

test('a line in another alphabet that the proofreader cannot translate goes; a product name in one stays', async () => {
  const {dropForeignLines} = await import('./concierge.mjs');
  assert.equal(dropForeignLines('הנה הדגמים המתאימים. Позиции для отображения:'), 'הנה הדגמים המתאימים.');
  assert.equal(dropForeignLines('הספר Мир Дедушки במלאי.', 'Мир Дедушки'), 'הספר Мир Дедушки במלאי.');
});
