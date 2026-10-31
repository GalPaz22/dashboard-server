import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createLearnedRewrites,normalizeQuery,COLLECTION} from './learned-rewrites.mjs';
import {createV2SearchLogger} from './search-logging.mjs';

// A small in-memory stand-in for the Mongo calls the module makes.
const value=(doc,path)=>path.split('.').reduce((v,k)=>v?.[k],doc);
const matches=(doc,filter)=>Object.entries(filter).every(([k,c])=>{const v=value(doc,k);
 if(c&&typeof c==='object'&&!(c instanceof Date)&&!Array.isArray(c))return Object.entries(c).every(([op,x])=>op==='$in'?x.includes(v):op==='$gte'?v>=x:op==='$exists'?(v!==undefined)===x:false);
 return v===c;});
function fakeDb(){
 const data={};
 const collection=name=>{const rows=data[name]??=[];return {
  find(filter={}){let out=rows.filter(r=>matches(r,filter));const c={sort(s){const [k,d]=Object.entries(s)[0];out=[...out].sort((a,b)=>(a[k]>b[k]?1:-1)*d);return c;},limit(n){out=out.slice(0,n);return c;},toArray:async()=>out.map(r=>({...r}))};return c;},
  async findOne(filter){return rows.find(r=>matches(r,filter))??null;},
  async insertOne(doc){if(rows.some(r=>r._id===doc._id&&doc._id!==undefined)){const e=Error('dup');e.code=11000;throw e;}rows.push({...doc});},
  async updateOne(filter,update){const r=rows.find(x=>matches(x,filter));if(!r)return {matchedCount:0};Object.assign(r,update.$set||{});for(const [k,n] of Object.entries(update.$inc||{}))r[k]=(r[k]||0)+n;return {matchedCount:1};},
  async findOneAndUpdate(filter,update){const r=await this.updateOne(filter,update);return r.matchedCount?{...rows.find(x=>matches(x,filter))}:null;}
 };};
 return {data,db:{collection}};
}

test('normalizeQuery ignores case, spacing and trailing punctuation',()=>{
 assert.equal(normalizeQuery('  מטען   לאוטו? '),'מטען לאוטו');
 assert.equal(normalizeQuery('iPhone  17!'),'iphone 17');
});

test('a model respelling is promoted on a repeat once a shopper engaged, then served directly and revoked when it fails',async()=>{
 const {data,db}=fakeDb();let t=Date.parse('2026-10-27T10:00:00Z');
 const learned=createLearnedRewrites({getDb:async()=>db,now:()=>t,log:{log(){},error(){}}});
 const lexical={mode:'llm-lexical',rewrites:['מטען לרכב']};
 const search=async(session,metadata=lexical)=>{db.collection('queries').insertOne({query:'מטען לאוטו',timestamp:new Date(t),session_id:session,searchMode:metadata.mode});await learned.observe('shop',{query:'מטען לאוטו',metadata,zeroResults:false});};
 await search('s1');
 assert.equal(data[COLLECTION][0].status,'candidate','the first respelling is only a candidate');
 t+=60e3;await db.collection('product_click_events').insertOne({session_id:'s1',timestamp:new Date(t),query:'מטען לאוטו'});
 t+=3600e3;await search('s2');
 assert.equal(data[COLLECTION][0].status,'active','a click after an earlier search promotes it on the repeat');
 assert.equal(data[COLLECTION][0].reason,'engagement');

 const req={body:{query:'מטען  לאוטו',session_id:'s3'},store:{dbName:'shop',semantix:{enabled:true}}};
 await learned.apply(req,{},()=>{});
 assert.equal(req.body.query,'מטען לרכב','the respelling is searched instead of what was typed');
 assert.deepEqual(req.semantixLearned,{query:'מטען  לאוטו',rewrite:'מטען לרכב'});
 const off={body:{query:'מטען לאוטו'},store:{dbName:'shop',semantix:{enabled:false}}};await learned.apply(off,{},()=>{});
 assert.equal(off.body.query,'מטען לאוטו','a store whose module is off is never rewritten');
 learned.restore(req,{},()=>{});assert.equal(req.body.query,'מטען  לאוטו','restore puts back what was typed when no module answered');

 await learned.observe('shop',{query:'מטען לאוטו',learned:{query:'מטען לאוטו',rewrite:'מטען לרכב'},zeroResults:false});
 assert.equal(data[COLLECTION][0].served,1);
 await learned.observe('shop',{query:'מטען לאוטו',learned:{query:'מטען לאוטו',rewrite:'מטען לרכב'},zeroResults:true});
 assert.equal(data[COLLECTION][0].status,'revoked','a served search with no results revokes it');
 const again={body:{query:'מטען לאוטו'},store:{dbName:'shop',semantix:{enabled:true}}};await learned.apply(again,{},()=>{});
 assert.equal(again.body.query,'מטען לאוטו','a revoked rewrite is no longer applied');
 t+=3600e3;await search('s9');assert.equal(data[COLLECTION][0].status,'revoked','and is never promoted again automatically');
});

test('without engagement the same respelling three times promotes; a changed respelling starts over; others are ignored',async()=>{
 const {data,db}=fakeDb();let t=Date.parse('2026-10-27T10:00:00Z');
 const learned=createLearnedRewrites({getDb:async()=>db,now:()=>t,log:{log(){},error(){}}});
 const observe=(rewrite,mode='llm-lexical',query='כסוי איפון')=>{t+=60e3;return learned.observe('shop',{query,metadata:{mode,rewrites:[rewrite]},zeroResults:false});};
 await observe('כיסוי אייפון');await observe('כיסוי iphone');await observe('כיסוי iphone');
 assert.equal(data[COLLECTION][0].status,'candidate','a changed respelling resets the count');
 await observe('כיסוי iphone');
 assert.equal(data[COLLECTION][0].status,'active');assert.equal(data[COLLECTION][0].reason,'repeated-rewrite');assert.equal(data[COLLECTION][0].rewrite,'כיסוי iphone');
 await observe('x','llm',"מה מתאים לילד");await observe('מטען','llm-lexical','מטען');
 assert.equal(data[COLLECTION].length,1,'semantic/consultative answers and respellings equal to the query are not learned');
});

test('a served rewrite with no click or cart over revokeAfterServed searches is revoked; unknown engagement never revokes',async()=>{
 const {data,db}=fakeDb();let t=Date.parse('2026-10-27T10:00:00Z'),broken=false;
 const getDb=async()=>broken?{collection:name=>name===COLLECTION?db.collection(name):{find(){throw Error('mongo down');}}}:db;
 const learned=createLearnedRewrites({getDb,now:()=>t,log:{log(){},error(){}},rules:{promoteSearches:3,engageWindowMs:30*60e3,lookbackMs:30*864e5,reviewEvery:2,revokeAfterServed:4}});
 await db.collection(COLLECTION).insertOne({_id:'גלקסי 26',query:'גלקסי 26',rewrite:'גלקסי s26',status:'active',promotedAt:new Date(t),served:0});
 const serve=async session=>{t+=60e3;await db.collection('queries').insertOne({query:'גלקסי 26',timestamp:new Date(t),session_id:session,learnedRewrite:'גלקסי s26'});await learned.observe('shop',{query:'גלקסי 26',learned:{query:'גלקסי 26',rewrite:'גלקסי s26'},zeroResults:false});};
 broken=true;for(const s of ['a','b','c','d'])await serve(s);
 assert.equal(data[COLLECTION][0].status,'active','a failed engagement read is unknown, not zero');
 broken=false;await serve('e');await serve('f');
 assert.equal(data[COLLECTION][0].status,'revoked');assert.equal(data[COLLECTION][0].reason,'no-engagement');
});

test('the v2 logger records how the engine answered and hands the search to the learner',async()=>{
 const logged=[],seen=[];
 const logger=createV2SearchLogger({logQuery:async(_c,query,_f,_p,_i,options)=>{logged.push({query,options});},getQueries:async()=>'q',onLogged:(db,s)=>{seen.push({db,...s});}});
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.store={dbName:'shop',semantix:{enabled:true}};next();});
 app.post('/search',logger,(req,_res,next)=>{if(req.body.query==='מטען לרכב')req.semantixLearned={query:'מטען לאוטו',rewrite:'מטען לרכב'};next();},(req,res)=>{
  res.setHeader('X-Semantix-Tenant','shipi@8');res.json({products:[{name:'מטען'}],pagination:{totalAvailable:1},metadata:{mode:req.semantixLearned?'text':'llm-lexical',phase:'router-lexical',llmUsed:!req.semantixLearned,routerMs:900,rewrites:['מטען לרכב'],cached:false}});});
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const post=query=>fetch(base+'/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,modern:true,session_id:'s1'})}).then(r=>r.json());
 try{
  await post('מטען לאוטו');await post('מטען לרכב');await new Promise(r=>setTimeout(r,20));
  const {elapsedMs,...meta}=logged[0].options.searchMeta;
  assert.ok(Number.isFinite(elapsedMs));
  assert.deepEqual(meta,{searchMode:'llm-lexical',searchPhase:'router-lexical',llmUsed:true,routerMs:900,cached:false,rewrites:['מטען לרכב']});
  assert.equal(seen[0].metadata.mode,'llm-lexical');assert.equal(seen[0].learned,undefined);
  assert.equal(logged[1].options.searchMeta.learnedRewrite,'מטען לרכב','a search served by a learned rewrite says so');
  assert.deepEqual(seen[1].learned,{query:'מטען לאוטו',rewrite:'מטען לרכב'});
 }finally{server.close();}
});
