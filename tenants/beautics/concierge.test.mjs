import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSystemPrompt,decideTrigger,catalogFacets,searchCatalog,createTurnRecorder} from '../../concierge.mjs';
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

test('Beautics lookups keep the grid; advice, empty and sold-out searches still open the chat',async()=>{
  const products=[{id:'1',name:'לק ג׳ל 288',stockStatus:'instock'}];
  for(const query of ['288','שמן','פרנ','Hard base 59','Basic 25','10 י״ח קרבייט'])
    assert.equal(await decideTrigger({store,query,payload:{products,metadata:{}}}),null,query);
  assert.equal((await decideTrigger({store,query:'איזה טופ מתאים?',payload:{products,metadata:{routerRoute:'consultative'}}})).reason,'non_literal');
  assert.equal((await decideTrigger({store,query:'288',payload:{products:[],metadata:{}}})).reason,'no_results');
  assert.equal((await decideTrigger({store,query:'288',payload:{products:[{id:'1',name:'לק',stockStatus:'outofstock'}],metadata:{}}})).reason,'out_of_stock');
  // Another store keeps the old behavior for the same query.
  assert.equal((await decideTrigger({store:{...store,dbName:'other'},query:'שמן',payload:{products:[{id:'1',name:'סבון',stockStatus:'instock'}],metadata:{}}})).reason,'non_literal');
});

test('an unreviewed Beautics non-literal search stays in the grid (fails closed)',async()=>{
  const products=[{id:'1',name:'סבון',stockStatus:'instock'}];
  assert.equal(await decideTrigger({store,query:'מחפש משהו לאישה מבוגרת',payload:{products,metadata:{}}}),null);
});

test('research results stay lean for the model and the prompt asks for batched detail',async()=>{
  const collection={find(){return {sort(){return this},limit(){return this},async toArray(){return [
    {id:'1',name:'בייס',categories:['בייסים'],status:'ACTIVE',stockStatus:'instock',price:69,url:'https://x/1',image:'https://x/1.jpg',description:'בייס מחזק'},
  ]}}}};
  const result=await searchCatalog({categories:['בייסים']},{store,deps:{getMongoClient:async()=>({db:()=>({collection:()=>collection})})}});
  const [product]=result.products;
  assert.equal(product.description,'בייס מחזק');assert.equal(product.url,undefined);assert.equal(product.image,undefined);
  assert.equal(product.colors,undefined);assert.equal(product.on_sale,undefined);
  const prompt=buildSystemPrompt(store);
  assert.ok(prompt.includes('product_ids'));assert.ok(!prompt.includes('קרא get_product עבור המוצרים הנבחרים'));
});

test('a saved turn keeps the whole answer the shopper saw and every card, without the discarded draft',()=>{
  const long='א'.repeat(9000);
  const recorder=createTurnRecorder({message:'בייס <b>לציפורניים</b>'});
  recorder.onEvent({type:'text',text:'טיוטה שנזרקה'});recorder.onEvent({type:'text_reset'});
  recorder.onEvent({type:'tool_end',tool:'search_catalog',ms:40,products:[]});
  recorder.onEvent({type:'tool_end',tool:'present_products',ms:5,products:[{product_id:'1',name:'בייס',price:69,url:'u',image:'i'},{product_id:'1',name:'בייס'}]});
  recorder.onEvent({type:'text',text:long});recorder.onEvent({type:'text',text:'!'});
  const turn=recorder.turn({stopped:'STOP',usage:{rounds:2}});
  assert.equal(turn.message,'בייס <b>לציפורניים</b>');assert.equal(turn.reply,long+'!');
  assert.deepEqual(turn.products,[{product_id:'1',name:'בייס',price:69,url:'u',image:'i'}]);
  assert.deepEqual(turn.tools.map(t=>t.tool),['search_catalog','present_products']);assert.equal(turn.rounds,2);
  const opening=createTurnRecorder({opening:true,trigger:{query:'טופ מתפשט',reason:'non_literal'}}).turn();
  assert.equal(opening.opening,true);assert.equal(opening.query,'טופ מתפשט');assert.equal(opening.message,undefined);
});
