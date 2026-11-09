import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchIndex,createIndexRetriever} from './tenants/steimatzky/engine/core/search-index.mjs';
import {createSearchService} from './tenants/steimatzky/engine/core/semantic.mjs';
import {stockLast,nearTitle,titledBy} from './tenants/steimatzky/engine/core/core.mjs';

// User rule 09.11.2026: every product the store still lists is shown even when sold out; only inactive (hidden) rows
// are not. Sold-out products keep their place among the products that are what the shopper named.
const profile={tenantId:'t',productTypes:{},colors:{},finishes:{},tagDefinitions:{},queryAliases:{},badgeRules:[],pipeline:{outOfStock:'last',seriesOrder:true}};
const book=(id,title,extra={})=>({id,tenantId:'t',title,description:'',categories:[],tags:[],colors:[],finishes:[],stockStatus:'instock',hidden:false,price:80,specifications:{},...extra});
const sold=(id,title,extra={})=>book(id,title,{stockStatus:'outofstock',...extra});
const setup=products=>createSearchService(products,profile,()=>{throw Error('no model call expected');},{retrieve:createIndexRetriever(products,profile,buildSearchIndex(products,'1')),lightweightRouter:false,expansion:'sparse',expandBelow:5});
const ids=r=>r.matches.map(p=>p.id);

test('a sold-out exact title follows its in-stock edition in another binding',async()=>{
 const r=await setup([sold('ex','הזחל הרעב'),book('board','הזחל הרעב-דפים עבים'),book('x','זחל קטן')])({query:'הזחל הרעב',limit:12});
 assert.deepEqual(ids(r).slice(0,2),['board','ex']);
});

test('a series\' sold-out volumes come before in-stock books that only share a word',async()=>{
 const r=await setup([book('v1','שאול החתול ומסבת הפיצה'),sold('v2','שאול החתול והשכן החדש'),sold('v3','שאול החתול והרקוד'),book('king','שאול המלך')])({query:'שאול החתול',limit:12});
 assert.deepEqual(ids(r).slice(0,3),['v1','v2','v3']);
 const t=stockLast([book('v1','שאול החתול ומסבת הפיצה'),book('king','שאול המלך'),sold('v2','שאול החתול והשכן החדש')],'שאול החתול');
 assert.deepEqual(t.map(p=>p.id),['v1','v2','king']);
});

test('a bracketed qualifier or another vowel spelling is still the exact title',async()=>{
 assert.ok(nearTitle({title:'TWILIGHT (20TH ANNIV ED)'},'twilight'));
 assert.ok(nearTitle({title:'הספרייה הראשונה שלי'},'הספריה הראשונה שלי'));
 assert.ok(!nearTitle({title:'הספריה המונטסורית הראשונה שלי'},'הספריה הראשונה שלי'));
 const r=await setup([book('m','הספריה המונטסורית הראשונה שלי'),book('own','הספרייה הראשונה שלי')])({query:'הספריה הראשונה שלי',limit:12});
 assert.equal(ids(r)[0],'own');
 const t=stockLast([book('ecl','ECLIPSE (TWILIGHT SAGA #3)'),sold('t1','TWILIGHT (TWILIGHT SAGA #1)'),book('t20','TWILIGHT (20TH ANNIV ED)')],'twilight');
 assert.deepEqual(t.map(p=>p.id),['t20','t1','ecl']);
});

test('one short word names no series: its titles keep the engine order',()=>{
 assert.ok(!titledBy({title:'אורי ומלך החושך'},'אורי'));
 const t=stockLast([book('a','מרד האקדמאים'),sold('b','אורי ומלך החושך'),book('c','השם אורי')],'אורי');
 assert.deepEqual(t.map(p=>p.id),['a','c','b']);
});

test('a sold-out product is shown, never dropped; a hidden one is not shown',async()=>{
 const r=await setup([sold('s','WEDDING PEOPLE'),book('x','OTHER PEOPLE'),book('h','WEDDING PEOPLE GUIDE',{hidden:true})])({query:'wedding people',limit:12});
 assert.equal(ids(r)[0],'s');assert.ok(!ids(r).includes('h'));
});
