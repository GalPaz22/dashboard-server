import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {processProduct} from './core.mjs';
import {createSpellingResolver} from './spelling.mjs';
import {createSearchService} from './semantic.mjs';
const client=JSON.parse(readFileSync(new URL('./client.json',import.meta.url)));
const make=(id,title,extra={})=>processProduct({id,name:title,status:'ACTIVE',stockStatus:'instock',price:100,categories:[],...extra},client);
const products=[make('split','מכשיר חיטוי אולטרה סוניק Ultra'),make('joined','אולטראסוניק ענק 2.5 ליטר'),make('bundle','תנור עיקור +אולטראסוניק ultra'),make('gel','גל אולטרה סאונד'),make('primer','אולטרא בונד פריימר')];
test('missing letter and word splitting match known variants, not nearby product types',()=>{
 const r=createSpellingResolver(products,client)('אולטרה סוני');
 assert.deepEqual(r.matches.map(p=>p.id),['bundle','joined','split']);assert.equal(r.metadata.llmCalls,0);
});
test('repairs keep price and visibility constraints',()=>{
 const resolve=createSpellingResolver([...products,make('hidden','אולטרה סוניק',{hidden:true}),make('stock','אולטרה סוניק',{stockStatus:'outofstock'}),{...make('foreign','אולטרה סוניק'),tenantId:'other'}],client);
 assert.equal(resolve('אולטרה סוני עד 50'),null);assert.equal(resolve('אולטרה סוני').matches.length,3);
});
test('numeric models, short tokens and long requests are not automatically repaired',()=>{
 const resolve=createSpellingResolver(products,client);
 for(const q of ['אולטרה 201','סוני','אני מחפשת אולטרה סוני לשימוש מקצועי'])assert.equal(resolve(q),null);
});
test('equally close unrelated interpretations are not silently chosen',()=>{
 const resolve=createSpellingResolver([make('a','abcdefg'),make('b','abcdehk')],client);
 assert.equal(resolve('abcdehg'),null);
});
test('HTTP service path uses correction without model calls and retains pagination',async()=>{
 let calls=0;const run=createSearchService(products,client,async()=>{calls++;throw Error('should not run');});
 const first=await run({query:'אולטרה סוני',limit:1});const next=await run({cursor:first.nextCursor,limit:1});
 assert.equal(first.metadata.mode,'spelling');assert.equal(first.total,3);assert.notEqual(first.matches[0].id,next.matches[0].id);assert.equal(calls,0);
});
