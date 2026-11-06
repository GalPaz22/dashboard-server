import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanReplyText, createReplyCleaner} from './concierge-script.mjs';

test('foreign letters inside a Hebrew word become Hebrew', () => {
  // Words from real Steimatzky replies, 03–05.11.
  assert.equal(cleanReplyText('תוכל לקроא את'), 'תוכל לקרוא את');
  assert.equal(cleanReplyText('שעוסק ישירות بمבנה התא'), 'שעוסק ישירות במבנה התא');
  assert.equal(cleanReplyText('המותحן של גרישם'), 'המותחן של גרישם');
  assert.equal(cleanReplyText('איזה סόג ספרות'), 'איזה סוג ספרות');
  assert.equal(cleanReplyText('סوج, סاءלון'), 'סוג, סאלון');
});

test('a lone foreign word between Hebrew words becomes Hebrew', () => {
  assert.equal(cleanReplyText('האם אחד מהכיוונים מתאים لما מחפשת?'), 'האם אחד מהכיוונים מתאים למא מחפשת?');
  assert.equal(cleanReplyText('ספר על חיים в עיר'), 'ספר על חיים ו עיר');
});

test('two foreign words in a row inside Hebrew are junk too; three or more are a name', () => {
  assert.equal(cleanReplyText('אפשר להציץ بروايات وخيارات אחרות'), 'אפשר להציץ ברואיאת וחיאראת אחרות');
  assert.equal(cleanReplyText('הספר Мир Дедушки и Внучек זמין'), 'הספר Мир Дедушки и Внучек זמין');
});

test('names in their own alphabet stay; scripts no catalog uses go', () => {
  assert.equal(cleanReplyText('Мир Дедушки и Внучек'), 'Мир Дедушки и Внучек');
  assert.equal(cleanReplyText('ספר בערבית أثر الفراشة في التربية'), 'ספר בערבית أثر الفراشة في التربية');
  assert.equal(cleanReplyText('ספר สาย טוב'), 'ספר  טוב');
  assert.equal(cleanReplyText('HARRY POTTER והארי'), 'HARRY POTTER והארי');
});

test('a word split across stream chunks is repaired whole', () => {
  const cleaner = createReplyCleaner();
  const out = ['ספרים מש', 'вחים ול', 'קроא ', 'עכשיו'].map(c => cleaner.push(c)).join('') + cleaner.flush();
  assert.equal(out, 'ספרים משוחים ולקרוא עכשיו');
  const name = createReplyCleaner();
  const kept = ['הספר Мир ', 'Дедушки и Вну', 'чек זמין, ו', 'גם لما ', 'שביקשת'].map(c => name.push(c)).join('') + name.flush();
  assert.equal(kept, 'הספר Мир Дедушки и Внучек זמין, וגם למא שביקשת');
});
