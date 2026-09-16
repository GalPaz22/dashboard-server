import test from 'node:test';import assert from 'node:assert/strict';
import {createGarminSearch} from './search.mjs';import {adaptProduct,projection} from './catalog.mjs';import {createGarminRoutes} from './routes.mjs';
const response=()=>({code:200,status(code){this.code=code;return this},setHeader(){},json(body){this.body=body;return this}});
function storage(){const rows=new Map();return {async createIndex(){},async insertMany(docs){for(const d of docs)rows.set(d._id,structuredClone(d));},async findOne(q){const d=rows.get(q._id);return d&&d.expiresAt>q.expiresAt.$gt?structuredClone(d):null;}};}
test('Woo objects, prices and stock are adapted without exposing embeddings',()=>{const p=adaptProduct({id:1,categories:[{name:'שעונים חכמים'}],tags:[{name:'חדש'}],regular_price:'30',price:'20',stockStatus:'outofstock',stock_status:'instock'});assert.equal(p.price,20);assert.equal(p.regularPrice,30);assert.deepEqual(p.categories,['שעונים חכמים']);assert.equal(p.stockStatus,'outofstock');assert.equal(projection.embedding,undefined);});
test('production filters square screens and excludes hidden/draft/accessory products without badges or LLM',async()=>{
 const data=[{id:1,name:'Venu Sq 2 Music',categories:[{name:'שעונים חכמים'}],badges:[{text:'NEW'}]}, {id:2,name:'fēnix 8',categories:[{name:'שעונים חכמים'}]}, {id:3,name:'Venu Sq watch band',categories:[{name:'רצועות לשעוני GARMIN'}]},{id:4,name:'Venu Sq',hidden:true},{id:5,name:'Venu Sq',status:'draft'}].map(p=>adaptProduct({status:'publish',stockStatus:'instock',...p}));
 const search=createGarminSearch({loadCatalog:async()=>data,generator:async()=>assert.fail('Unexpected LLM')});
 const r=await search({request:{query:'שעון מסך מרובע'}});assert.deepEqual(r.matches.map(p=>p.id),['1']);assert.deepEqual(r.matches[0].badges,[{text:'NEW'}]);assert.equal(r.metadata.llmUsed,false);
});
test('unavailable square screen yields marked watch alternatives rather than straps',async()=>{
 const products=[adaptProduct({id:1,name:'fenix 8',categories:['שעונים חכמים'],status:'publish',stockStatus:'instock'}),adaptProduct({id:2,name:'watch band',categories:['רצועות לשעוני GARMIN'],status:'publish',stockStatus:'instock'})];
 const search=createGarminSearch({loadCatalog:async()=>products,generator:async()=>{throw Error('Provider unavailable');}});
 const r=await search({request:{query:'שעון מסך מרובע'}});assert.equal(r.metadata.fullMatch,false);assert.deepEqual(r.matches.map(p=>p.id),['1']);assert.equal(r.matches[0].matchQuality,'alternative');
});
test('ranked snapshot continues in a fresh worker without loading catalog or repeating LLM',async()=>{
 const products=Array.from({length:65},(_,id)=>adaptProduct({id,name:'fēnix 8 AMOLED',categories:['שעונים חכמים'],status:'publish',stockStatus:'instock'}));const sessions=storage();
 const search=createGarminSearch({loadCatalog:async()=>products,generator:async()=>assert.fail()});let r=await search({sessions,request:{query:'fenix',limit:12}});const ids=r.matches.map(p=>p.id);
 const fresh=createGarminSearch({loadCatalog:async()=>assert.fail('Reloaded catalog')});
 while(r.nextCursor){r=await fresh({sessions,request:{cursor:r.nextCursor,limit:20}});ids.push(...r.matches.map(p=>p.id));}
 assert.equal(ids.length,65);assert.equal(new Set(ids).size,65);
});
test('flag gating, tenant isolation, legacy contracts and stale cursors',async()=>{
 let calls=0;const routes=createGarminRoutes({getDb:async()=>({collection:()=>({})}),enabled:()=>true,search:async({request})=>{calls++;if(request.cursor)throw Error('Search expired; start a new search');return {matches:[{title:'Watch',badges:[]}],total:1,nextCursor:null};}});
 let passed=false;await routes.search({store:{dbName:'other'},body:{}},response(),()=>passed=true);assert.ok(passed);
 const legacy=response();await routes.search({store:{dbName:'garmin'},body:{query:'watch'}},legacy,()=>assert.fail());assert.ok(Array.isArray(legacy.body));
 const modern=response();await routes.search({store:{dbName:'garmin'},body:{query:'watch',modern:true}},modern,()=>assert.fail());assert.equal(modern.body.metadata.searchEngine,'garmin-v2');
 const wrong=response();await routes.loadMore({store:{dbName:'other'},query:{token:'garmin-v2:abc'}},wrong,()=>assert.fail());assert.equal(wrong.code,400);
 const expired=response();await routes.loadMore({store:{dbName:'garmin'},query:{token:'garmin-v2:abc'}},expired,()=>assert.fail());assert.equal(expired.code,410);
 const invalid=response();await routes.search({store:{dbName:'garmin'},body:{query:'watch',limit:0}},invalid,()=>assert.fail());assert.equal(invalid.code,400);
 const off=createGarminRoutes({enabled:()=>false});passed=false;await off.search({store:{dbName:'garmin'}},response(),()=>passed=true);assert.ok(passed);assert.equal(calls,3);
});
