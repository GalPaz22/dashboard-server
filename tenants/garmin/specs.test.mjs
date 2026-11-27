import test from 'node:test';
import assert from 'node:assert/strict';
import {batteryNumbers, compareSpecs, readSpecs, specLines, waterMetres} from '../../concierge-compare.mjs';
import {garminSpecs, modelKey} from './specs.mjs';

// Shapes copied from garmin.products (Nov 2026): WooCommerce attributes, one spec named several ways.
const attr = (name, ...options) => ({name, options});
const fr570 = {name: 'Forerunner® 570 - Black| 42mm', attributes: [
  attr('גודל השעון', '42 מ"מ'), attr('משקל', '42 גרם'), attr('דירוג עמידות למים', '5ATM'), attr('חומר העדשה', 'Corning® Gorilla® Glass 3'),
  attr('סוג התצוגה', 'AMOLED (עם מצב תמיד פעיל אופציונלי)'), attr('חיי סוללה', 'מצב שעון חכם: עד 10 ימים מצב GNSS עם GPS בלבד: עד 18 שעות'),
  attr('רמקול ומיקרופון מובנים', '✓'), attr('Garmin ECG', '-'), attr('מפות מובנות', '-'), attr('מפות אתרי סקי', '-'), attr('הקפה ידנית', '✓'),
]};
const fr965 = {name: 'Forerunner® 965 | 47mm', attributes: [
  attr('מידות פיזיות', '47 מ"מ'), attr('משקל', '53 גרם'), attr('מסך צבעוני', 'AMOLED'), attr('זמן סוללה - שעון חכם', 'עד 23 ימים'),
  attr('דירוג עמידות למים', '5 ATM'), attr('מפות אתרי סקי', '-'),
]};

test('specs are read from the store attributes, however each one is named', () => {
  const {fields, more} = readSpecs(fr570, garminSpecs);
  assert.equal(fields.get('size').display, '42 מ"מ');
  assert.equal(fields.get('weight').value, 42);
  assert.equal(fields.get('water').value, 50);
  assert.deepEqual([fields.get('battery_smart').value, fields.get('battery_gps').value], [10, 18]);
  assert.equal(fields.get('calls').value, true);
  assert.equal(fields.get('ecg').value, false);
  assert.equal(fields.get('maps').value, false);
  assert.ok(more.some((m) => m.label === 'הקפה ידנית'));
  // Size from the dimensions; battery from its own attribute; a "-" on ski maps alone says nothing about maps.
  const thin = readSpecs(fr965, garminSpecs).fields;
  assert.equal(thin.get('size').display, '47 מ"מ');
  assert.equal(thin.get('battery_smart').value, 23);
  assert.equal(thin.has('maps'), false);
});

test('battery and water figures come out of free text', () => {
  assert.deepEqual(batteryNumbers('עד 9 ימים (מצב שעון חכם) עד 9 שעות GPS'), {smart: 9, gps: null});
  assert.deepEqual(batteryNumbers('מצב שעון חכם: עד 11 ימים · GPS: עד 26 שעות'), {smart: 11, gps: 26});
  assert.deepEqual([waterMetres('10ATM'), waterMetres('ATM 10'), waterMetres('צלילה (100 מטר)')], [100, 100, 100]);
});

test('a comparison marks what differs, the better battery and the decisive rows first', () => {
  const table = compareSpecs([fr570, fr965], garminSpecs);
  const row = (key) => table.rows.find((r) => r.key === key);
  assert.equal(row('water').differs, false, '5ATM = 5 ATM');
  assert.equal(row('battery_smart').best, 1);
  assert.equal(row('weight').best, null, 'lighter is not ranked');
  assert.deepEqual(row('size').values, ['42 מ"מ', '47 מ"מ']);
  assert.equal(row('calls').values[1], null, 'not listed stays empty');
  assert.equal(row('display_type').differs, false, 'the same display, worded with and without a note');
  assert.deepEqual(table.summary.slice(0, 3), ['size', 'battery_smart', 'battery_gps']);
  assert.ok(table.summary.length <= 8);
});

test('a thin spec sheet borrows only what is the same for every colour of the model', () => {
  const sibling = {name: 'Forerunner® 965 | Whitestone', attributes: [attr('רמקול ומיקרופון מובנים', '✓'), attr('משקל', '99 גרם'), attr('טעינה סולארית', '✓')]};
  const {fields} = readSpecs(fr965, garminSpecs, sibling);
  assert.equal(fields.get('calls').value, true);
  assert.equal(fields.get('weight').value, 53, 'weight is never borrowed');
  assert.equal(fields.has('solar'), false, 'solar editions differ');
});

test('model keys group colours and sizes of one model', () => {
  assert.equal(modelKey('שעון ספורט fēnix® 8 – 47mm AMOLED'), 'fenix 8');
  assert.equal(modelKey('Forerunner® 265 | Black Bezel with White'), modelKey('Forerunner® 265 | 46mm'));
  assert.equal(modelKey('מגבת מנדפת זיעה Tacx Towel'), null);
});

test('specLines give a product its key specs for questions about it', () => {
  const lines = specLines(fr570, garminSpecs, 6);
  assert.equal(lines[0], 'גודל השעון: 42 מ"מ');
  assert.equal(lines.length, 6);
});

const sheet = (name, more = {}) => ({ name, attributes: Object.entries({ 'דגם': 'Venu® 3', 'קוטר': '45x45x12 מ"מ', 'משקל': '46 גרם', 'מתאים להיקף יד': '135-200 מ"מ',
  'גודל מסך תצוגה': '1.4"', 'תאימות לסוג רצועה': 'Quick Release 22mm', 'מה בערכה': 'שעון ספורט חכם Venu 3', 'דירוג עמידות למים': '5ATM', ...more })
  .map(([n, v]) => ({ name: n, options: [v] })) });

test('the Venu 4 sheets the store copied from Venu 3 are replaced by the maker\'s figures', async () => {
  const { compareSpecs } = await import('../../concierge-compare.mjs');
  const { correctDescription } = await import('./spec-corrections.mjs');
  const table = compareSpecs([sheet('Venu® 4 (41mm) - Bone'), sheet('Venu® 4 | 45mm - Black')], garminSpecs);
  const row = (key) => table.rows.find((r) => r.key === key).values;
  assert.deepEqual(row('size'), ['41 מ"מ', '45 מ"מ']);
  assert.deepEqual(row('display_size'), ['1.2"', '1.4"']);
  assert.deepEqual(row('band_fit'), ['Quick Release 18mm', 'Quick Release 22mm']);
  assert.deepEqual(row('wrist_fit'), ['110-175 מ"מ', '135-200 מ"מ']);
  assert.deepEqual(row('battery_smart'), ['עד 10 ימים', 'עד 12 ימים']);
  assert.deepEqual(row('model'), ['Venu 4', 'Venu 4']);
  assert.ok(row('in_box').every((v) => v.includes('Venu 4')));
  assert.equal(correctDescription('Venu 4 (45mm)', 'מסך בגודל 1.2 אינץ’, עד 10 ימים'), 'מסך בגודל 1.4 אינץ’, עד 12 ימים');
  assert.equal(correctDescription('Venu 3 | 45mm', 'מסך 1.4 אינץ'), 'מסך 1.4 אינץ');
});

test('a sheet that states another size than the title keeps nothing that depends on size', async () => {
  const { compareSpecs } = await import('../../concierge-compare.mjs');
  const { correctSheet } = await import('./spec-corrections.mjs');
  const wrong = sheet('שעון ספורט fēnix® 8 – 51mm Sapphire', { 'קוטר': '47x47x15.2 מ"מ' });
  const table = compareSpecs([wrong, sheet('Venu® 3 | 45mm')], garminSpecs);
  const first = (key) => table.rows.find((r) => r.key === key)?.values[0];
  assert.equal(first('size'), '51 מ"מ');
  for (const key of ['dimensions', 'weight', 'wrist_fit', 'display_size', 'band_fit']) assert.equal(first(key), null, key);
  assert.equal(first('water'), '5ATM');
  assert.match(correctSheet(wrong).specNote, /47/);
  const right = sheet('Venu® 3 | 45mm', { 'קוטר': '45.4x45.4x11 מ"מ' });
  assert.equal(correctSheet(right), right);
});
