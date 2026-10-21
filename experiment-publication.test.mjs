import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {ObjectId} from 'mongodb';
import {publishStoreExperiments,readExperimentPublication,mountExperimentPublication} from './experiment-publication.mjs';
function fixture(){
 const saved=new Map(),checks=[],writes=[],id=new ObjectId();
 const own={_id:id,dbName:'garmin',status:'running',delivery:'randomized',layer:'weekly',targeting:{mode:'queryMatch',matchType:'exact',patterns:['265']},trafficPct:100,arms:[{key:'control',weight:1,patch:{}},{key:'v1',weight:1,patch:{demotedProductIds:['x']}}]};
 const client={db:name=>({collection:collection=>({find(filter){checks.push({name,collection,filter});return {limit(){return this;},async toArray(){return collection==='experiments'?[own]:[{apiKey:'own'},{apiKey:'sibling'}];}};}})})};
 const redis={get:async key=>saved.get(key)||null,set:async(k,v,options)=>{saved.set(k,v);writes.push({k,options});},del:async k=>{saved.delete(k);writes.push({k});}};
 return {client,redis,saved,writes,checks,own,store:{dbName:'garmin',apiKey:'own'}};
}
test('publication reads approved store definitions from Mongo and writes all sibling keys with bounded TTL',async()=>{const f=fixture(),result=await publishStoreExperiments(f);assert.equal(result.published,true);assert.deepEqual(result.experimentIds,[String(f.own._id)]);assert.deepEqual(f.checks[0].filter,{dbName:'garmin',status:'running'});assert.deepEqual(f.checks[1].filter,{dbName:'garmin'});assert.deepEqual(f.writes.map(w=>w.k),['experiments:active:own','experiments:active:sibling']);assert.equal(f.writes[0].options.EX,120);const wire=JSON.parse(f.saved.get('experiments:active:own'));assert.deepEqual(wire[0].arms[0].patch,{});assert.equal(wire[0].delivery,'randomized');assert.equal(wire[0].tenantApiKey,undefined);});
test('stopping the last experiment deletes both keys and confirms absence, never a false successful write',async()=>{const f=fixture();await publishStoreExperiments(f);f.client.db=()=>({collection:name=>({find:()=>({limit(){return this;},async toArray(){return name==='experiments'?[]:[{apiKey:'sibling'}];}})})});const result=await publishStoreExperiments(f);assert.deepEqual(result.experimentIds,[]);assert.equal(f.saved.size,0);const broken=fixture();broken.redis.set=async()=>{};await assert.rejects(publishStoreExperiments(broken));});
test('status is read-only and missing Redis never acknowledges publication',async()=>{const f=fixture();assert.deepEqual((await readExperimentPublication(f)).experimentIds,[]);assert.equal(f.writes.length,0);await assert.rejects(publishStoreExperiments({...f,redis:null}),e=>e.status===503);await assert.rejects(publishStoreExperiments({...f,store:{apiKey:'own'}}),e=>e.status===401);});
test('HTTP bridge uses authenticated store context and ignores supplied store/patch overrides',async()=>{
 const f=fixture(),app=express();app.use(express.json());app.use((req,res,next)=>{if(req.get('x-api-key')!=='own')return res.sendStatus(401);req.store=f.store;next();});mountExperimentPublication(app,{getClient:async()=>f.client,getRedis:()=>f.redis});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/experiments/publication`;
 try{assert.equal((await fetch(url)).status,401);const read=await fetch(url,{headers:{'x-api-key':'own'}});assert.equal(read.status,200);assert.equal(f.writes.length,0);const write=await fetch(url,{method:'POST',headers:{'x-api-key':'own','content-type':'application/json'},body:JSON.stringify({dbName:'foreign',tenantApiKey:'other',arms:[{patch:{hideAll:true}}]})});assert.equal(write.status,200);assert.equal(f.checks[0].filter.dbName,'garmin');assert.equal(JSON.parse(f.saved.get('experiments:active:own'))[0].arms[1].patch.hideAll,undefined);}finally{await new Promise(r=>server.close(r));}
});
