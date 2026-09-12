import {test} from 'node:test';import assert from 'node:assert/strict';import {app} from './server.mjs';
test('local studio denies foreign host, cross-origin and missing operator token',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 try {
  assert.equal((await fetch(url+'/api/session')).status,403);
  const host='127.0.0.1:'+(process.env.STUDIO_PORT||4320);
  assert.equal((await fetch(url+'/api/session',{headers:{Host:host,Origin:'https://foreign.example'}})).status,403);
  assert.equal((await fetch(url+'/api/projects',{headers:{Host:host}})).status,403);
  assert.equal((await fetch(url+'/api/projects',{headers:{Host:host}})).status,403);
 }finally{await new Promise(r=>server.close(r))}
});
