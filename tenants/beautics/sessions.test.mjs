import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchSessions} from './sessions.mjs';
import {createBeauticsLoadMore} from './pagination.mjs';
import {storefrontResponse} from './response.mjs';
import {searchBeautics} from './search.mjs';

function storage() {
  const documents = new Map();
  return {
    async createIndex() {},
    async insertMany(docs) {for (const doc of docs) documents.set(doc._id,structuredClone(doc));},
    async findOne(query) {
      const doc = documents.get(query._id);
      return doc && doc.expiresAt > query.expiresAt.$gt ? structuredClone(doc) : null;
    },
  };
}

test('stored pages survive a fresh service and cross chunk boundaries without rerunning search',async()=>{
  const db = storage();
  const matches = Array.from({length:123},(_,id)=>({id:String(id),title:`Product ${id}`}));
  let calls = 0;
  const search = async ({cursor,limit}) => {
    calls++;
    const offset = Number(cursor);
    return {matches:matches.slice(offset,offset+limit),nextCursor:offset+limit < matches.length ? String(offset+limit) : null};
  };
  const first = await createSearchSessions(db).save({matches:matches.slice(0,12),total:123,nextCursor:'12',metadata:{mode:'text'}},search,12);
  const callsAfterSave = calls;
  let result = storefrontResponse(first,true);
  const ids = result.products.map(p=>p.id);
  // Production entry point with no catalog or in-memory service available.
  const handler = createBeauticsLoadMore(request=>searchBeautics({sessions:db,request}));
  while (result.pagination.hasMore) {
    const res = {status(code){assert.fail(`Unexpected HTTP ${code}`)},json(value){result=value}};
    const token = result.pagination.nextToken;
    await handler({store:{dbName:'woo-beautics-shop-co-il'},query:{token,limit:'20'}},res,()=>assert.fail());
    ids.push(...result.products.map(p=>p.id));
    // Retrying the same cursor returns the same immutable page.
    const replay = await createSearchSessions(db).read(token.slice('beautics-v2:'.length),20);
    assert.deepEqual(replay.matches,result.products.map(({name,badges,...p})=>p));
  }
  assert.deepEqual(ids,matches.map(p=>p.id));
  assert.equal(calls,callsAfterSave);
  assert.equal(result.pagination.nextToken,null);
});

test('snapshot expiry and unknown cursors are rejected; a new search does not replace existing snapshots',async()=>{
  const db = storage();let time = 1000;
  const sessions = createSearchSessions(db,{now:()=>time});
  const save = id => sessions.save({matches:[{id}],total:2,nextCursor:'next'},async()=>({matches:[{id:`${id}-next`}],nextCursor:null}),1);
  const first = await save('original');
  await save('refreshed');
  assert.equal((await sessions.read(first.nextCursor,1)).matches[0].id,'original-next');
  await assert.rejects(()=>sessions.read('old-process-uuid',1),/expired/);
  await assert.rejects(()=>sessions.read('snapshot:00000000-0000-0000-0000-000000000000:1',1),/expired/);
  time += 30*60*1000;
  await assert.rejects(()=>sessions.read(first.nextCursor,1),/expired/);
});

test('production initial search persists a cursor readable by a newly loaded tenant module',async()=>{
  const sessions = storage();
  const products = Array.from({length:65},(_,id)=>({id:String(id),name:'לק סגול',categories:["לק ג'ל- צבעים",'סגולים'],price:30,stockStatus:'instock',status:'publish'}));
  const collection = {find(){return {limit(){return this},batchSize(){return this},async toArray(){return products},async close(){}}}};
  const first = await searchBeautics({collection,sessions,request:{query:'לק סגול',limit:12}});
  assert.match(first.nextCursor,/^snapshot:/);
  const fresh = await import('./search.mjs?fresh-worker');
  let cursor = first.nextCursor;
  const ids = first.matches.map(p=>p.id);
  while (cursor) {
    const result = await fresh.searchBeautics({sessions,request:{cursor,limit:20}});
    ids.push(...result.matches.map(p=>p.id));cursor=result.nextCursor;
  }
  assert.equal(ids.length,65);assert.equal(new Set(ids).size,65);
});
