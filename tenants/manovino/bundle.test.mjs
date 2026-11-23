import test from 'node:test';
import assert from 'node:assert/strict';
import { arrange, canFill, cleanSlots, matchesType, poolsFor, tierPools, parseDeal, dealOf, buildPools, validatePick, priceBundle, compactRow, bundleAnswer } from './bundle.mjs';

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

const kindRow = (id, kind, deal = 'שניים ב- 149.9') => row(id, 85, deal, { category: [kind] });

test('type is a rule: red slots take red bottles only', () => {
  assert.equal(matchesType(kindRow(1, 'יין אדום'), 'אדום'), true);
  assert.equal(matchesType(kindRow(2, 'יין לבן'), 'אדום'), false);
  assert.equal(matchesType(kindRow(3, 'יין רוזה'), 'כל סוג'), true);
  assert.equal(matchesType(kindRow(4, 'סאקה'), 'כל סוג'), false);
  const red = [{ type: 'אדום', region: 'פורטוגל' }, { type: 'אדום', region: 'פורטוגל' }];
  assert.equal(canFill([kindRow(1, 'יין אדום'), kindRow(2, 'יין לבן')], red), false);
  assert.equal(canFill([kindRow(1, 'יין אדום'), kindRow(2, 'יין אדום')], red), true);
});

test('arrange puts the bottles in slot order, or refuses a wrong mix', () => {
  const slots = [{ type: 'אדום' }, { type: 'רוזה' }];
  assert.deepEqual(arrange([kindRow(2, 'יין רוזה'), kindRow(1, 'יין אדום')], slots).map(p => p.id), [1, 2]);
  assert.equal(arrange([kindRow(1, 'יין אדום'), kindRow(3, 'יין לבן')], slots), null);
});

test('deals that cannot fill the slots are not offered when another can', () => {
  const pools = buildPools([kindRow(1, 'יין אדום', 'שניים ב- 149.9'), kindRow(2, 'יין לבן', 'שניים ב- 149.9'), kindRow(3, 'יין אדום', 'שניים ב- 109.9'), kindRow(4, 'יין אדום', 'שניים ב- 109.9')].map(p => ({ ...p, price: p.specialSales[0].name.includes('109') ? 59 : 85 })));
  const offered = poolsFor(pools, cleanSlots([{ type: 'אדום', region: '' }, { type: 'אדום', region: '' }]));
  assert.deepEqual([...offered.keys()], ['שניים ב-109.9']);
});

test('parseDeal reads every name the store uses', () => {
  assert.deepEqual(parseDeal({ name: 'הדילים מהשולחן | 2 ב149.9' }), { key: 'שניים ב-149.9', n: 2, total: 149.9 });
  assert.deepEqual(parseDeal({ name: 'הדילים מהשולחן | 3 ב- 129.9' }), { key: 'שלושה ב-129.9', n: 3, total: 129.9 });
  assert.deepEqual(parseDeal({ name: 'הדילים מהשולחן | 2 ב109.9 ' }), { key: 'שניים ב-109.9', n: 2, total: 109.9 });
  assert.deepEqual(parseDeal({ name: '\tנובמבר סייל | 4-269' }), { key: 'ארבעה ב-269', n: 4, total: 269 });
  assert.deepEqual(parseDeal({ name: '\tנובמבר סייל | 6- 239' }), { key: 'שישה ב-239', n: 6, total: 239 });
  assert.equal(parseDeal({ name: "בירות ימי ראשון | טוניק ג'ינג'ר ביר ג'ינג'ר אייל  4 ב 36 " }), null);
});

test('level moves the set to another price tier of the same size', () => {
  const mk = (id, price, name) => ({ ...row(id, price, name), category: ['יין אדום'] });
  const pools = buildPools([mk(1, 59, 'שניים ב- 109.9'), mk(2, 85, 'שניים ב- 149.9'), mk(3, 130, 'שניים ב- 219')]);
  const keys = r => [...r.pools.keys()];
  assert.deepEqual(keys(tierPools(pools, 'up', 'שניים ב-109.9')), ['שניים ב-149.9']);
  assert.deepEqual(keys(tierPools(pools, 'up', 'שניים ב-149.9')), ['שניים ב-219']);
  assert.deepEqual(tierPools(pools, 'up', 'שניים ב-219').edge, true);
  assert.deepEqual(keys(tierPools(pools, 'down', 'שניים ב-149.9')), ['שניים ב-109.9']);
  assert.deepEqual(keys(tierPools(pools, 'premium')), ['שניים ב-219']);
  assert.deepEqual(keys(tierPools(pools, 'budget')), ['שניים ב-109.9']);
  assert.equal(tierPools(pools, 'same').pools.size, 3);
});

test('a bottle in two deals is offered in both, whatever order the store lists them', () => {
  const both = (a, b) => ({ ...row(9, 85, null), specialSales: [{ name: a }, { name: b }] });
  for (const bottle of [both('הדילים מהשולחן | 2 ב149.9', 'נובמבר סייל | 4-269'), both('נובמבר סייל | 4-269', 'הדילים מהשולחן | 2 ב149.9')]) {
    const pools = buildPools([bottle]);
    assert.deepEqual([...pools.keys()].sort(), ['ארבעה ב-269', 'שניים ב-149.9']);
  }
});
