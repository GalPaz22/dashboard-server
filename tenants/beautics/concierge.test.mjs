import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSystemPrompt,decideTrigger,catalogFacets,searchCatalog} from '../../concierge.mjs';
import client from '../../pilot/beautics/client.json' with {type:'json'};
import {createTopSearch} from './top-search.mjs';
import {createSearchService} from '../../pilot/beautics/semantic.mjs';
import {processProduct} from '../../pilot/beautics/core.mjs';
const store={dbName:'woo-beautics-shop-co-il',products:'products',conciergeEnabled:true};

test('top advice reaches the model router instead of being treated as a failed literal product filter',async()=>{
  const products=[processProduct({id:'1',name:'טופ מבריק',categories:['טופים'],status:'ACTIVE',stockStatus:'instock',price:69},client)];
  const resolver=createTopSearch(products,client);
  for(const query of ['איזה טופ מתאים למתחילה','מה ההבדל בין טופ לבייס','טופ מומלץ']) assert.equal(resolver(query),null);
  const stages=[];
  const run=createSearchService(products,client,async({stage})=>{stages.push(stage);if(stage==='route')return {data:{route:'consultative',rewrites:[],message:''}};throw Error('No provider in test');},{catalogSearch:resolver});
  const result=await run({query:'איזה טופ מתאים למתחילה'});
  assert.equal(stages[0],'route');assert.equal(result.metadata.routerRoute,'consultative');
  assert.equal((await decideTrigger({store,query:'איזה טופ מתאים למתחילה',payload:{...result,products:result.matches}})).reason,'non_literal');
});

test('Beautics instructions extend default and merchant prompts without affecting another store',()=>{
  const tailored=buildSystemPrompt(store);
  assert.ok(tailored.includes('ביוטיקס'));assert.ok(tailored.includes('Splash Gel'));assert.ok(tailored.includes('2–4'));
  const custom=buildSystemPrompt({...store,conciergeSystemPrompt:'CUSTOM',context:'SHOP'});
  assert.ok(custom.includes('CUSTOM'));assert.ok(custom.includes('SHOP'));assert.ok(custom.includes('ביוטיקס'));
  assert.equal(buildSystemPrompt({dbName:'other',conciergeSystemPrompt:'CUSTOM'}),'CUSTOM');
});

test('model consultative routing opens chat; a resolved Beautics search stays in the grid',async()=>{
  const products=[{id:'1',name:'טופ',stockStatus:'instock'}];
  const consult=await decideTrigger({store,query:'איזה טופ מתאים למתחילה?',payload:{products,metadata:{routerRoute:'consultative'}}});
  assert.equal(consult.reason,'non_literal');assert.equal(consult.display,'auto');
  assert.equal(await decideTrigger({store,query:'טופ מתפשט',payload:{products,metadata:{fullMatch:true}}}),null);
  const other=await decideTrigger({store:{...store,dbName:'other'},query:'טופ מתפשט',payload:{products,metadata:{fullMatch:true}}});
  assert.equal(other.reason,'non_literal');
});

test('Beautics catalog facets use the synced categories and tags fields',async()=>{
  const pipelines=[];
  const collection={aggregate(pipeline){pipelines.push(pipeline);return {async toArray(){return []}}}};
  await catalogFacets({}, {store,deps:{getMongoClient:async()=>({db:()=>({collection:()=>collection})})}});
  assert.equal(pipelines[0][1].$unwind,'$categories');assert.equal(pipelines[1][1].$unwind,'$tags');
  assert.deepEqual(pipelines[0][0].$match.status,{$in:['ACTIVE','publish']});
});

test('category browsing filters before the retrieval limit and exposes categories to the model',async()=>{
  let filter,projection;
  const collection={find(match,options){filter=match;projection=options.projection;return {sort(){return this},limit(){return this},async toArray(){return [
    {id:'1',name:'טופ',categories:['טופים'],tags:['מבריק'],status:'ACTIVE',stockStatus:'instock',price:69},
    {id:'2',name:'טופ מוסתר',categories:['טופים'],status:'DRAFT',stockStatus:'instock',price:69},
  ]}}}};
  const result=await searchCatalog({categories:['טופים']},{store,deps:{getMongoClient:async()=>({db:()=>({collection:()=>collection})})}});
  assert.deepEqual(filter.categories,{$in:['טופים']});assert.equal(projection.categories,1);
  assert.equal(result.products.length,1);assert.deepEqual(result.products[0].categories,['טופים']);
  assert.deepEqual(result.products[0].tags,['מבריק']);
});
