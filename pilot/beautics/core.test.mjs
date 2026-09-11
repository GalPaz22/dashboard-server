import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {processProduct,search,autocomplete} from './core.mjs';
const client=JSON.parse(readFileSync(new URL('./client.json',import.meta.url)));
const raw=(id,extra={})=>({id,name:'לק סגול',categories:["לק ג'ל- צבעים",'סגולים'],price:30,stockStatus:'instock',status:'publish',url:`https://www.beautics-shop.co.il/product/${id}`,...extra});
const make=(id,extra)=>processProduct(raw(id,extra),client);
test('merchant categories remain candidates without product-scoped evidence',()=>{
  const p=make('1',{categories:['חדש באתר','10 ב399 ש״ח'],specialLabel:true});
  assert.equal(p.badges.length,0);assert.equal(p.badgeCandidates.length,2);assert.ok(p.issues.includes('legacy-label-without-meaning'));
});
test('observations only attach to the matching product and disappear on complete rebuild',()=>{
  const evidence=[{url:raw('1').url,badges:[{kind:'new',text:'חדש',selector:'.custom-label'}]}];
  assert.equal(processProduct(raw('1'),client,evidence,'2026-09-11').badges.length,1);
  assert.equal(processProduct(raw('2'),client,evidence).badges.length,0);
  assert.equal(processProduct(raw('1'),client,[]).badges.length,0);
});
test('source stock contradiction is reported, not displayed as a badge',()=>{
  const p=processProduct(raw('1'),client,[{url:raw('1').url,badges:[{kind:'stock',text:'אזל מהמלאי'}]}]);
  assert.deepEqual(p.issues,['source-stock-conflict']);assert.equal(p.badges.length,0);
});
test('purple sheets, missing colors, hidden, other tenants and stock are excluded',()=>{
  const products=[make('good'),make('sheet',{categories:['סגולים'],name:'סדין סגול'}),make('unknown',{categories:["לק ג'ל- צבעים"]}),make('hidden',{hidden:true}),make('out',{stockStatus:'outofstock'}),{...make('other'),tenantId:'other'}];
  assert.deepEqual(search(products,client,{query:'לק סגול'}).matches.map(p=>p.id),['good']);
});
test('unresolved terms and price constraints are never silently discarded',()=>{
  assert.equal(search([make('1')],client,{query:'לק סגול מנצנץ'}).total,0);
  assert.equal(search([make('1')],client,{query:'לק עד 20'}).total,0);
});
test('load more retains query; revisions and mixed requests are rejected',()=>{
  const products=[make('1'),make('2'),make('3')];
  const first=search(products,client,{query:'לק סגול',limit:2});
  assert.deepEqual(search(products,client,{cursor:first.nextCursor}).matches.map(p=>p.id),['3']);
  assert.throws(()=>search(products,client,{query:'אחר',cursor:first.nextCursor}));
  assert.throws(()=>search(products.slice(1),client,{cursor:first.nextCursor}));
});
test('SKU and autocomplete respect visibility',()=>{
  const products=[make('1',{raw:{sku:'AB-10'}}),make('2',{hidden:true})];
  assert.equal(search(products,client,{query:'AB-10'}).plan.strategy,'identifier');
  assert.deepEqual(autocomplete(products,client,'לק').map(p=>p.id),['1']);
  assert.deepEqual(autocomplete(products,client,''),[]);
});
test('synced ACTIVE is published; PRIVATE and DRAFT are excluded',()=>{
  const products=[make('active',{status:'ACTIVE'}),make('private',{status:'PRIVATE'}),make('draft',{status:'DRAFT'})];
  assert.deepEqual(search(products,client,{query:'לק סגול'}).matches.map(p=>p.id),['active']);
});
test('finish is a required catalog attribute, including when absent from title',()=>{
  const products=[make('glitter',{categories:["לק ג'ל- צבעים",'סגולים','מנצנצים']}),make('plain')];
  assert.deepEqual(search(products,client,{query:'לק סגול מנצנץ'}).matches.map(p=>p.id),['glitter']);
  assert.equal(search(products,client,{query:'לק סגול מנצנץ ריחני'}).total,0);
});
test('observed merchant-label retains its page and null prices cannot prove a sale',()=>{
  const observations=[{url:raw('1').url,sourceUrl:'https://www.beautics-shop.co.il/product-category/purple',observedAt:'2026-09-11',badges:[{kind:'merchant-label',text:'10 ב399 ש״ח'},{kind:'sale',text:'מבצע'}]}];
  const p=processProduct(raw('1',{price:null,regularPrice:60}),client,observations);
  assert.equal(p.badges.length,1);assert.equal(p.badges[0].sourceUrl,observations[0].sourceUrl);assert.ok(p.issues.includes('source-sale-conflict'));
});
