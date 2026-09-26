import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createV2SearchLogger} from './search-logging.mjs';

test('v2 engine searches are logged once to the store queries collection; pages, legacy and failures are not',async()=>{
 const logged=[];let failLog=false;
 const logQuery=async(collection,query,filters,products,isComplex,options)=>{if(failLog)throw Error('mongo down');logged.push({collection,query,products:products.map(p=>p.name),options});};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.store={dbName:req.get('X-Store')};next();});
 app.post('/search',createV2SearchLogger({logQuery,getQueries:async db=>'queries@'+db}),(req,res,next)=>{
  if(req.store.dbName!=='woo-beautics-shop-co-il')return next();
  res.setHeader('X-Search-Engine','beautics-v2');
  if(req.body.cursor)return res.json({products:[{name:'p3'}],pagination:{totalAvailable:3}});
  return res.json(req.body.modern?{products:[{name:'טופ 1'},{title:'טופ 2'}],pagination:{totalAvailable:2}}:[]);
 },(_req,res)=>res.json({legacy:true}));
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const post=(body,store='woo-beautics-shop-co-il')=>fetch(base+'/search',{method:'POST',headers:{'Content-Type':'application/json','X-Store':store},body:JSON.stringify(body)}).then(r=>r.json());
 const settle=()=>new Promise(r=>setTimeout(r,20));
 try{
  assert.equal((await post({query:'טופ',modern:true,session_id:'s1'})).products.length,2);await settle();
  assert.deepEqual(logged[0],{collection:'queries@woo-beautics-shop-co-il',query:'טופ',products:['טופ 1','טופ 2'],options:{session_id:'s1',sessionId:undefined,zeroResults:false,searchEngine:'beautics-v2'}});
  await post({query:'בילדר גל'});await settle();assert.equal(logged[1].options.zeroResults,true,'a zero-result search is flagged');
  await post({cursor:'abc'});await settle();assert.equal(logged.length,2,'cursor pages are not new searches');
  assert.deepEqual(await post({query:'x'},'other-store'),{legacy:true});await settle();assert.equal(logged.length,2,'the legacy pipeline logs itself');
  failLog=true;assert.equal((await post({query:'טופ',modern:true})).products.length,2,'a failing log never breaks the response');
 }finally{server.close();}
});
