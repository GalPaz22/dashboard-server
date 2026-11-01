import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {createSearchService}=await import(process.env.CARMELLA_SEARCH_ENGINE||'./tenants/carmella/engine/core/semantic.mjs');
const profile=enabled=>({tenantId:'shipi',productTypes:{},queryAliases:{},semanticAliases:{},scopedAliases:[],colors:{},finishes:{},tagDefinitions:{},rankingRules:[],hookData:{catalogSearchRules:{alwaysResults:enabled}}});
const product=(id,extra={})=>({id,title:'כיסוי לאייפון 18 פרו '+id,tenantId:'shipi',description:'',categories:[],tags:['sxguard0familyiphone18'],colors:[],finishes:[],specifications:{},price:50,stockStatus:'instock',hidden:false,...extra});
const unavailable=async()=>{throw Error('provider unavailable');};

test('always-results survives an exact guard that rejects every candidate and marks alternatives truthfully',async()=>{
 const products=[product('yes'),product('hidden',{hidden:true}),product('sold',{stockStatus:'outofstock'})];
 const search=createSearchService(products,profile(true),unavailable,{lightweightRouter:false,expansion:'off',hooks:{has:n=>n==='rerank',rerank:async()=>[]},retrieve:()=>({status:'matched',plan:{terms:[]},matches:[products[0]],total:1})});
 const r=await search({query:'sxguard0modeliphone99',limit:12});assert.deepEqual(r.matches.map(p=>p.id),['yes']);assert.equal(r.metadata.fullMatch,false);assert.equal(r.metadata.exactMatch,false);assert.equal(r.metadata.alwaysResults,true);assert.ok(r.matches.every(p=>p.matchQuality==='alternative'));
});

test('unknown queries and a failed model still return sellable results',async()=>{
 const products=[product('a'),product('b')];const search=createSearchService(products,profile(true),unavailable,{lightweightRouter:false,expansion:'off',retrieve:()=>({status:'empty',plan:{terms:['xyz']},matches:[],total:0})});
 const r=await search({query:'xyz',limit:12});assert.ok(r.matches.length);assert.equal(r.metadata.fullMatch,false);assert.equal(r.metadata.alwaysResults,true);
});

test('relaxed tenant matches are alternatives, matching family results remain direct, and pagination preserves the labels',async()=>{
 const products=Array.from({length:4},(_,i)=>product(String(i)));const make=()=>createSearchService(products,profile(true),unavailable,{expansion:'off',lightweightRouter:false,retrieve:()=>({status:'matched',plan:{terms:[]},matches:products,total:products.length})});
 const wrong=await make()({query:'sxguard0modeliphone99',limit:2});assert.equal(wrong.metadata.fullMatch,false);assert.ok(wrong.nextCursor);
 const s=make(),first=await s({query:'sxguard0modeliphone99',limit:2}),next=await s({cursor:first.nextCursor,limit:2});assert.ok(next.matches.every(p=>p.matchQuality==='alternative'));assert.equal(next.metadata.fullMatch,false);
 const exact=await make()({query:'sxguard0familyiphone18',limit:2});assert.equal(exact.metadata.fullMatch,true);assert.ok(exact.matches.every(p=>p.matchQuality!=='alternative'));
});

test('the fallback is opt-in and cannot invent results for an empty eligible catalog',async()=>{
 const products=[product('a')];const search=createSearchService(products,profile(false),unavailable,{expansion:'off',hooks:{has:n=>n==='rerank',rerank:async()=>[]},retrieve:()=>({status:'matched',plan:{terms:[]},matches:products,total:1})});assert.equal((await search({query:'sxguard0modeliphone99'})).total,0);
 const empty=createSearchService([product('hidden',{hidden:true})],profile(true),unavailable,{lightweightRouter:false,expansion:'off',retrieve:()=>({status:'empty',plan:{terms:[]},matches:[],total:0})});assert.equal((await empty({query:'xyz'})).total,0);
});

test('autocomplete returns source-backed alternatives without calling a model for an unknown query',async()=>{
 const runtime=process.env.CARMELLA_SEARCH_RUNTIME?pathToFileURL(process.env.CARMELLA_SEARCH_RUNTIME).href:new URL('./tenants/carmella/engine/runtime.mjs',import.meta.url).href;
 const {createDraftRuntime}=await import(runtime),client={...profile(true),badgeRules:[],badgeCandidates:{},pipeline:{}};
 const p={id:'shipi',url:'https://shipi.co.il/',platform:'woocommerce',catalog:{products:[{id:'a',name:'כיסוי לאייפון 18 פרו',status:'ACTIVE',stockStatus:'instock',categories:[],tags:[],price:50},{id:'b',name:'כבל חדש',status:'ACTIVE',stockStatus:'instock',categories:[],tags:[],price:30}]}};
 const rt=createDraftRuntime(p,{number:1,profile:client}),r=await rt.suggest('zxqv999999');assert.ok(r.matches.length);assert.ok(r.matches.every(p=>p.matchQuality==='alternative'));
 const relaxed=await rt.suggest('כיסוי sxguard0modeliphone99');assert.ok(relaxed.matches.length);assert.ok(relaxed.matches.every(p=>p.matchQuality==='alternative'));
});

test('lexical-first answers a guarded compound food query without calling the model',async()=>{
 let calls=0;const products=[product('oil',{title:'שמן זית כתית חדש',tags:['sxguard0kindoil','sxguard0termolive']}),product('tuna',{title:'טונה בשמן זית',tags:['sxguard0kindtuna']})];
 const service=createSearchService(products,profile(true),async()=>{calls++;throw Error('unneeded model');},{lexicalFirst:true,retrieve:()=>({status:'matched',matches:products.slice(0,1),total:1,plan:{terms:[]}})});const r=await service({query:'שמן זית sxguard0kindoil sxguard0termolive'});assert.ok(r.matches.length);assert.equal(r.metadata.llmUsed,false);assert.equal(calls,0);
});

test('internal identity guards preserve the merchant ranking of fresh products',async()=>{
 const {applyRanking}=await import(process.env.CARMELLA_SEARCH_RANKING||'./tenants/carmella/engine/core/ranking.mjs');const products=[{id:'can',title:'עגבניות קלופות',categories:['שימורים']},{id:'fresh',title:'עגבניות טריות',categories:['ירקות']}],rules=[{action:'boost',field:'categories',values:['ירקות'],terms:[],match:'direct',weight:5}];
 assert.equal(applyRanking(products,rules,'עגבניות sxguard0kindtomato').matches[0].id,'fresh');
});
