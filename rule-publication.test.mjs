import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { publishStoreRules, mountRulePublication } from './rule-publication.mjs';
function fixture() {
 const state={rows:[],fail:false},checks=[];
 const client={db:name=>({collection:collection=>({find(filter){checks.push({name,collection,filter});if(state.fail)throw Error('offline');return {sort(){return this;},limit(){return this;},async toArray(){return collection==='users'?[{apiKey:'own',platform:'woocommerce',credentials:{dbName:'store',pinnedResults:[]}}]:state.rows;}};}})})};
 return {state,checks,client,store:{dbName:'store',apiKey:'own'}};
}
test('publication refreshes the same Mongo-backed search reader and detects later edits without Redis',async()=>{
 const f=fixture(),before=await publishStoreRules(f);assert.equal(before.published,true);assert.equal(before.dbName,'store');assert.equal(before.propagationSeconds,15);assert.match(before.revision,/^[a-f\d]{64}$/);
 f.state.rows=[{_id:'saved-rule',merchantQuery:'wine',condition:{mode:'queryMatch',matchType:'exact',patterns:['wine']},patch:{pinnedResults:[{query:'wine',productIds:['first']}]}}];
 assert.notEqual((await publishStoreRules(f)).revision,before.revision);
 f.state.rows=[];assert.equal((await publishStoreRules(f)).revision,before.revision);
 f.state.fail=true;await assert.rejects(publishStoreRules(f),/offline/);await assert.rejects(publishStoreRules({...f,store:{apiKey:'own'}}),e=>e.status===401);
});
test('HTTP publication uses only the authenticated store, refuses unauthenticated calls and does not accept patches',async()=>{
 const f=fixture(),app=express();app.use(express.json());app.use((req,res,next)=>{if(req.get('x-api-key')!=='own')return res.sendStatus(401);req.store=f.store;next();});mountRulePublication(app,{getClient:async()=>f.client});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/rules/publication`;
 try{assert.equal((await fetch(url,{method:'POST'})).status,401);const r=await fetch(url,{method:'POST',headers:{'x-api-key':'own','content-type':'application/json'},body:JSON.stringify({dbName:'foreign',patch:{hideAll:true}})});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const data=await r.json();assert.equal(data.dbName,'store');assert.equal(data.mode,'search-mongo');assert.ok(f.checks.every(c=>c.filter.dbName==='store'||c.filter.$or?.[0].dbName==='store'));assert.equal(JSON.stringify(data).includes('own'),false);
 f.state.fail=true;const failure=await fetch(url,{method:'POST',headers:{'x-api-key':'own'}});assert.equal(failure.status,503);assert.notEqual((await failure.json()).published,true);
 }finally{await new Promise(r=>server.close(r));}
});
