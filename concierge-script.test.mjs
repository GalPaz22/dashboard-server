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

test('names in their own alphabet stay; scripts no catalog uses go', () => {
  assert.equal(cleanReplyText('Мир Дедушки и Внучек'), 'Мир Дедушки и Внучек');
  assert.equal(cleanReplyText('ספר בערבית أثر الفراشة'), 'ספר בערבית أثر الفراشة');
  assert.equal(cleanReplyText('ספר สาย טוב'), 'ספר  טוב');
  assert.equal(cleanReplyText('HARRY POTTER והארי'), 'HARRY POTTER והארי');
});

test('a word split across stream chunks is repaired whole', () => {
  const cleaner = createReplyCleaner();
  const out = ['ספרים מש', 'вחים ול', 'קроא ', 'עכשיו'].map(c => cleaner.push(c)).join('') + cleaner.flush();
  assert.equal(out, 'ספרים משוחים ולקרוא עכשיו');
});
