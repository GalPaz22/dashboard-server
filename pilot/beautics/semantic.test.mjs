import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSearchService as createFullService } from './semantic.mjs';
// Tests for the deeper retrieval layer; router behavior has a separate suite.
const createSearchService=(p,c,g,o={})=>createFullService(p,c,g,{...o,lightweightRouter:false});
import {processProduct} from './core.mjs';
const client=JSON.parse(readFileSync(new URL('./client.json',import.meta.url)));
const make=(id,extra={})=>processProduct({id,name:'שואב אבק לציפורניים',url:'https://www.beautics-shop.co.il/product/'+id,categories:['שואבי אבק'],price:100,status:'ACTIVE',stockStatus:'instock',...extra},client);
const interpretation={intent:'שאיבת אבק בשיוף',categories:['שואבי אבק'],terms:['שואב'],requirements:['שאיבת אבק בשיוף'],maxPrice:null,minPrice:null,colors:[],finishes:[],clarification:''};
const choice=id=>({id,evidence:[{requirement:0,field:'title',quote:'שואב אבק'}]});
function mock(plan=interpretation,ids=['1','2']){const calls=[];return {calls,generate:async request=>{calls.push(request);return{data:request.stage==='interpret'?plan:{matches:ids.map(choice)}};}};}
test('text hits never call LLM; semantic fallback uses two calls, load more/cache use none',async()=>{
 const m=mock();const run=createSearchService([make('1'),make('2')],client,m.generate);
 const text=await run({query:'שואב אבק'});assert.equal(text.metadata.llmUsed,false);assert.equal(m.calls.length,0);
 const first=await run({query:'איך לאסוף את האבק בזמן השיוף',limit:1});assert.equal(first.metadata.mode,'llm');assert.equal(first.total,2);assert.equal(m.calls.length,2);
 const second=await run({cursor:first.nextCursor});assert.deepEqual(second.matches.map(p=>p.id),['2']);
 await run({query:'איך לאסוף את האבק בזמן השיוף'});assert.equal(m.calls.length,2);
});
test('invented IDs and invented quotes are rejected',async()=>{
 const run=createSearchService([make('1')],client,async({stage})=>({data:stage==='interpret'?interpretation:{matches:[choice('fake'),{id:'1',evidence:[{requirement:0,field:'title',quote:'מסנן רפואי'}]}]}}));
 assert.ok((await run({query:'שואב מקצועי מומלץ'})).total>=1);
});
test('hard color/type/price constraints survive an attempted LLM relaxation',async()=>{
 const p=make('1',{name:'לק סגול',categories:["לק ג'ל- צבעים",'סגולים'],price:80});
 const plan={...interpretation,categories:["לק ג'ל- צבעים"],terms:['לק'],maxPrice:200};const m=mock(plan,['1']);
 const run=createSearchService([p],client,m.generate);const result=await run({query:'לק סגול לאירוע עד 50'});
 assert.ok(result.total>=1);assert.ok(result.metadata.neverEmpty);assert.equal(m.calls.length,1);
});
test('hidden, out-of-stock and other-tenant products never reach the LLM',async()=>{
 const m=mock(interpretation,['1','hidden','stock','foreign']);
 const run=createSearchService([make('1'),make('hidden',{hidden:true}),make('stock',{stockStatus:'outofstock'}),{...make('foreign'),tenantId:'other'}],client,m.generate);
 const result=await run({query:'לאסוף אבק בזמן עבודה'});assert.deepEqual(result.matches.map(p=>p.id),['1']);
 assert.ok(!m.calls[1].prompt.includes('"id":"hidden"'));assert.ok(!m.calls[1].prompt.includes('"id":"foreign"'));
});
test('missing requirement evidence rejects a partial match',async()=>{
 const m=mock({...interpretation,requirements:['שאיבת אבק','פעולה שקטה']},['1']);
 const result=await createSearchService([make('1')],client,m.generate)({query:'שואב שקט במיוחד'});assert.ok(result.total>=1);assert.ok(result.metadata.neverEmpty);
});
test('provider failure returns catalog alternatives and is not cached as an exact answer',async()=>{
 let calls=0;const run=createSearchService([make('1')],client,async()=>{calls++;throw Error('provider secret must not appear');});
 const result=await run({query:'שאיבה מקצועית'});assert.equal(result.status,'matched');assert.ok(result.metadata.neverEmpty);assert.ok(!JSON.stringify(result).includes('secret'));
 const again=await run({query:'שאיבה מקצועית'});assert.equal(calls,1);assert.equal(again.metadata.cached,true);
});
test('timeout bounds a provider that ignores abort',async()=>{
 const run=createSearchService([make('1')],client,()=>new Promise(()=>{}),{timeoutMs:10});
 assert.equal((await run({query:'שאיבה מקצועית'})).metadata.failure,'timeout');
});
test('duplicate requests share work and foreign/expired cursors are rejected',async()=>{
 let now=0;const m=mock();const run=createSearchService([make('1'),make('2')],client,m.generate,{now:()=>now,ttlMs:100});
 const [a,b]=await Promise.all([run({query:'לאסוף אבק',limit:1}),run({query:'לאסוף אבק',limit:1})]);assert.equal(m.calls.length,2);assert.equal(b.total,2);
 await assert.rejects(run({cursor:a.nextCursor,query:'changed'}));await assert.rejects(run({cursor:'fake'}));now=101;await assert.rejects(run({cursor:a.nextCursor}));
});
test('ambiguous request can clarify without a candidate call',async()=>{
 const m=mock({...interpretation,requirements:[],clarification:'איזה סוג מוצר מחפשים?'});const result=await createSearchService([make('1')],client,m.generate)({query:'משהו טוב'});
 assert.equal(result.status,'clarify');assert.equal(m.calls.length,1);
});
