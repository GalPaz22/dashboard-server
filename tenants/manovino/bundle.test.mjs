import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeal, dealOf, buildPools, validatePick, priceBundle, compactRow, bundleAnswer } from './bundle.mjs';

const row = (id, price, deal, extra = {}) => ({ id, name: `יין ${id} | המלצה של מנו`, price, image: 'i', url: `https://x/${id}`, stockStatus: 'instock', category: ['יין אדום'], specialSales: deal ? [{ name: deal }] : [], description: 'סוג יין: אדום\nזן ענבים: קברנה\nאזור גיאוגרפי: גליל', ...extra });

test('parseDeal reads "שניים ב- 109.9" and ignores unnamed promotions', () => {
  assert.deepEqual(parseDeal({ name: 'שניים ב- 109.9' }), { key: 'שניים ב-109.9', n: 2, total: 109.9 });
  assert.deepEqual(parseDeal('שלושה ב-129.9'), { key: 'שלושה ב-129.9', n: 3, total: 129.9 });
  assert.equal(parseDeal({ name: 'undefined' }), null);
  assert.equal(parseDeal(null), null);
});

test('pools hold only sellable bottles whose deal really saves money', () => {
  const pools = buildPools([row(1, 59, 'שניים ב- 109.9'), row(2, 59, 'שניים ב- 109.9', { stockStatus: 'outofstock' }), row(3, 50, 'שניים ב- 109.9'), row(4, 59, 'שניים ב- 109.9', { url: 'https://x/shop/inactive/4' }), row(5, 42, 'שלושה ב- 109.9'), row(6, 70, null)]);
  assert.deepEqual([...pools.keys()].sort(), ['שלושה ב-109.9', 'שניים ב-109.9']);
  assert.deepEqual(pools.get('שניים ב-109.9').rows.map(p => p.id), [1]);
});

test('a pick must be n different bottles of that one deal', () => {
  const pools = buildPools([row(1, 59, 'שניים ב- 109.9'), row(2, 60, 'שניים ב- 109.9'), row(5, 42, 'שלושה ב- 109.9')]);
  assert.equal(validatePick(pools, 'שניים ב-109.9', ['1', '2']).rows.length, 2);
  assert.equal(validatePick(pools, '## שניים ב-109.9 (2 בקבוקים)', [1, 2]).rows.length, 2);
  assert.equal(validatePick(pools, 'שניים ב-109.9', ['1', '1']), null);
  assert.equal(validatePick(pools, 'שניים ב-109.9', ['1', '5']), null);
  assert.equal(validatePick(pools, 'שניים ב-109.9', ['1']), null);
  assert.equal(validatePick(pools, 'שלושה ב-109.9', ['1', '2', '5']), null);
});

test('the price is the deal total, worked out here', () => {
  const pools = buildPools([row(1, 59, 'שניים ב- 109.9'), row(2, 60, 'שניים ב- 109.9')]);
  const picked = validatePick(pools, 'שניים ב-109.9', ['1', '2']);
  assert.deepEqual(priceBundle(picked.deal, picked.rows), { full: 119, total: 109.9, save: 9.1 });
  const out = bundleAnswer(picked, { reply: 'סט', notes: [{ id: '1', why: 'עשיר' }] });
  assert.equal(out.total, 109.9); assert.equal(out.products[0].why, 'עשיר'); assert.equal(out.products[1].why, '');
});

test('compact row keeps the facts the model needs', () => {
  assert.match(compactRow(row(7, 59, 'שניים ב- 109.9')), /^7\|יין 7\|59\|יין אדום\|אדום; קברנה; גליל/);
  assert.equal(dealOf(row(7, 59, 'שניים ב- 109.9')).n, 2);
});
