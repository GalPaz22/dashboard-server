import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSearchService} from '../../pilot/beautics/semantic.mjs';
import {processProduct} from '../../pilot/beautics/core.mjs';
import {storefrontResponse} from './response.mjs';
import {createBeauticsLoadMore} from './pagination.mjs';

const client=JSON.parse(readFileSync(new URL('../../pilot/beautics/client.json',import.meta.url)));
function response() { return {code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}}; }
const store={dbName:'woo-beautics-shop-co-il'};

test('storefront tokens paginate the v2 results to exhaustion without duplicates or LLM calls',async()=>{
  const products=Array.from({length:29},(_,i)=>processProduct({id:String(i),name:'לק סגול',categories:["לק ג\'ל- צבעים",'סגולים'],price:30,stockStatus:'instock',status:'publish'},client));
  const search=createSearchService(products,client,async()=>{throw Error('Unexpected LLM call')});
  let page=storefrontResponse(await search({query:'לק סגול',limit:12}),true);
  const ids=page.products.map(p=>p.id);
  const handler=createBeauticsLoadMore(search);
  while(page.pagination.hasMore) {
    assert.ok(page.pagination.nextToken);
    const res=response();
    await handler({store,query:{token:page.pagination.nextToken,limit:'12'}},res,()=>assert.fail('Entered legacy search'));
    assert.equal(res.code,200);
    page=res.body;ids.push(...page.products.map(p=>p.id));
  }
  assert.equal(ids.length,29);assert.equal(new Set(ids).size,29);
  assert.equal(page.pagination.nextToken,null);assert.equal(page.nextCursor,null);
});

test('legacy tokens pass through; wrong tenant, invalid limits and expired cursors are rejected',async()=>{
  let calls=0;
  const handler=createBeauticsLoadMore(async()=>{calls++;throw Error('Invalid cursor')});
  let passed=false;await handler({query:{token:'legacy'}},response(),()=>{passed=true});assert.ok(passed);
  for(const [req,status] of [
    [{store:{dbName:'other'},query:{token:'beautics-v2:abc'}},400],
    [{store,query:{token:'beautics-v2:abc',limit:'0'}},400],
    [{store,query:{token:'beautics-v2:'}},400],
    [{store,query:{token:'beautics-v2:expired'}},410],
  ]) {
    const res=response();await handler(req,res,()=>assert.fail());assert.equal(res.code,status);
  }
  assert.equal(calls,1);
});
