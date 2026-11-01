import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHookRunner} from './tenants/shipi/engine/core/tenant-hooks.mjs';

test('Shipi can rerank a broad collection with megabytes of source attributes',async()=>{
 const hooks=createHookRunner({rerank:{code:'function rerank(matches){return matches.filter(p=>p.tags.includes("cases")).map(p=>p.id);}'}},{},{tenant:'shipi-budget'});
 const matches=Array.from({length:5000},(_,i)=>({id:String(i),title:'כיסוי לסמארטפון',tags:['cases'],categories:['כיסויים'],specifications:{source:'x'.repeat(1200)}}));
 try{const result=await hooks.rerank(matches,'כיסויים');assert.equal(result.length,5000);assert.equal(result[4999].id,'4999');}finally{hooks.close();}
});
test('Shipi still stops runaway functions for small and large requests',async()=>{
 for(const large of [false,true]){
  const hooks=createHookRunner({rerank:{code:'function rerank(matches){while(true){}}'}},{},{tenant:'shipi-loop-'+large,timeoutMs:30});
  try{const start=Date.now();await assert.rejects(hooks.rerank([{id:'1',specifications:{source:large?'x'.repeat(3*1048576):''}}],'כיסויים'),/timed out|חרגה|Script execution/);assert.ok(Date.now()-start<2000,'Deadline must stay bounded');}finally{hooks.close();}
 }
});
