import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftRuntime} from './engine/runtime.mjs';
import {hash} from './engine/core/hash.mjs';
import {createTenantRoutes,manifest} from './index.mjs';

const profile={name:'Mano Vino',domain:'wine',productTypes:{},colors:{},finishes:{},queryAliases:{},tagDefinitions:{},badgeRules:[],pipeline:{expansion:'off',lightweightRouter:false}};
const soaps=Array.from({length:5},(_,i)=>({id:'soap-'+i,title:'סבון יין טבעי '+i,description:'יין טבעי לבן',tags:[],stockStatus:'instock',hidden:false}));
const wines=Array.from({length:10},(_,i)=>({id:'wine-'+i,title:'כרם טבעי '+i,description:'יין טבעי לבן, יינות טבעיים',tags:['יין'],stockStatus:'instock',hidden:false}));
const runtime=(products=[...soaps,...wines])=>createDraftRuntime({id:manifest.tenantId,url:manifest.url,platform:manifest.platform,productCards:products.map(p=>({categories:[],collections:[],colors:[],finishes:[],specifications:{},...p})),productCardsProfileHash:hash(profile),catalog:{products:[]}},{number:14,profile});

test('wine autocomplete removes soaps before the limit, including unfinished natural-wine queries',async()=>{
 const rt=runtime();
 for(const query of ['יין טבעי','יין טבע','יין טבעי לבן','יין','יינות טבעיים','יין-טבעי','יין  טבעי']){
  const result=await rt.suggest(query,{limit:8});
  assert.equal(result.matches.length,8,query);assert.ok(result.matches.every(p=>p.id.startsWith('wine-')),query);
 }
});
test('explicit soap searches still find the soaps and other autocomplete queries retain them',async()=>{
 const rt=runtime();
 for(const query of ['סבון יין טבעי','סבון'])assert.equal((await rt.suggest(query)).matches.filter(p=>p.id.startsWith('soap-')).length,5,query);
 assert.ok((await rt.suggest('טבעי')).matches.some(p=>p.id.startsWith('soap-')));
});
test('wine suggestions still enforce hidden and out-of-stock products',async()=>{
 const rt=runtime([...soaps,...wines.map((p,i)=>({...p,hidden:i===0,stockStatus:i===1?'outofstock':'instock'}))]);
 const result=await rt.suggest('יין טבעי');assert.equal(result.matches.length,8);
 assert.ok(result.matches.every(p=>p.id.startsWith('wine-')&&!p.hidden&&p.stockStatus==='instock'));
});
test('a wine autocomplete with only soaps is intentionally empty, and does not fall back to legacy suggestions',async()=>{
 const rt=runtime(soaps),result=await rt.suggest('יין טבעי');assert.deepEqual(result.matches,[]);
 const search=async()=>{};search.suggest=async()=>({...result,revision:14});
 const routes=createTenantRoutes({search,getDb:async()=>({collection:()=>({})})});let next=0,body;
 await routes.autocomplete({store:{dbName:manifest.dbName,semantix:{module:manifest.slug,enabled:true}},query:{query:'יין טבעי'}},{setHeader(){},json(value){body=value;}},()=>next++);
 assert.equal(next,0);assert.deepEqual(body,[]);
});
test('empty unrelated autocomplete keeps the legacy fallback',async()=>{
 const search=async()=>{};search.suggest=async()=>({matches:[],revision:14});let next=0;
 const routes=createTenantRoutes({search,getDb:async()=>({collection:()=>({})})});
 await routes.autocomplete({store:{dbName:manifest.dbName,semantix:{module:manifest.slug,enabled:true}},query:{query:'משהו'}},{json(){assert.fail('must fall back');}},()=>next++);
 assert.equal(next,1);
});
