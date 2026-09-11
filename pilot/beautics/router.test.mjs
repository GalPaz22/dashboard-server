import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSearchService} from './semantic.mjs';
import {processProduct} from './core.mjs';
const client=JSON.parse(readFileSync(new URL('./client.json',import.meta.url)));
const make=(id,title,extra={})=>processProduct({id,name:title,status:'ACTIVE',stockStatus:'instock',price:100,categories:['מכונות שיוף'],...extra},client);
test('transliteration uses one router call, text retrieval and cached pagination',async()=>{
 const stages=[];const run=createSearchService([make('1','Strong 207'),make('2','Strong 210')],client,async({stage})=>{stages.push(stage);return{data:{route:'lexical',rewrites:['strong'],message:''}};});
 const a=await run({query:'סטרונג',limit:1});assert.equal(a.metadata.mode,'llm-lexical');assert.equal(a.total,2);await run({cursor:a.nextCursor});assert.deepEqual(stages,['route']);
});
test('French spelling gets lexical interpretation without semantic selection',async()=>{
 const run=createSearchService([make('1',"לק פרנץ' לבן")],client,async()=>({data:{route:'lexical',rewrites:["פרנץ'"],message:''}}));
 const r=await run({query:'פרנצ׳'});assert.equal(r.total,1);assert.equal(r.metadata.llmCalls,1);
});
test('router cannot remove a detected price cap or change a model number',async()=>{
 const stages=[];const run=createSearchService([make('1','Strong 210')],client,async({stage})=>{stages.push(stage);if(stage==='route')return{data:{route:'lexical',rewrites:['Strong 210'],message:''}};throw Error('stop before live model');});
 const r=await run({query:'סטרונג 207'});assert.equal(r.status,'matched');assert.ok(r.metadata.neverEmpty);assert.deepEqual(stages,['route','interpret']);
 const cap=createSearchService([make('1','Strong')],client,async({stage})=>{if(stage==='route')return{data:{route:'lexical',rewrites:['Strong 50'],message:''}};throw Error('stop');});assert.ok((await cap({query:'סטרונג עד 50'})).total>=1);
});
test('consultative routing preserves original request and enters deeper reasoning',async()=>{
 const stages=[];const query='מה מתאים למתחילה';const run=createSearchService([make('1','Strong')],client,async({stage,prompt})=>{
  stages.push(stage);assert.ok(prompt.includes(query));
  if(stage==='route')return{data:{route:'consultative',rewrites:[],message:''}};
  if(stage==='interpret')return{data:{intent:'מכונה למתחילה',categories:['מכונות שיוף'],terms:['Strong'],requirements:['מתאים למתחילה'],minPrice:null,maxPrice:null,colors:[],finishes:[],clarification:''}};
  return{data:{matches:[]}};
 });const r=await run({query});assert.deepEqual(stages,['route','interpret','select']);assert.equal(r.metadata.routerRoute,'consultative');assert.equal(r.metadata.llmCalls,3);assert.ok(r.total>=1);
});
test('unusable normalization falls through with the original query',async()=>{
 const stages=[];const run=createSearchService([make('1','Strong')],client,async({stage,prompt})=>{stages.push(stage);if(stage==='route')return{data:{route:'lexical',rewrites:['absent'],message:''}};assert.ok(prompt.includes('סטרונג'));throw Error('stop');});
 assert.equal((await run({query:'סטרונג'})).status,'matched');assert.deepEqual(stages,['route','interpret']);
});
