import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogLoader} from './catalog.mjs';
test('concurrent searches share one projected read; TTL refreshes same-size catalogs',async()=>{
 let time=0, reads=0, closed=0, selected;
 const collection={find(_,options){reads++; selected=options.projection;return {limit(){return this},batchSize(){return this},async toArray(){await new Promise(r=>setTimeout(r,5));return [{id:'1',price:reads}]},async close(){closed++}}}};
 const load=createCatalogLoader({ttlMs:10,now:()=>time});
 const results=await Promise.all(Array.from({length:50},()=>load(collection)));
 assert.equal(reads,1);assert.equal(closed,1);assert.ok(results.every(r=>r===results[0]));
 assert.equal(selected['raw.sku'],1);assert.equal(selected.embedding,undefined);assert.equal(selected.raw,undefined);
 time=11;const fresh=await load(collection);assert.equal(reads,2);assert.equal(fresh[0].price,2);
});
test('failed read closes cursor and permits retry',async()=>{
 let closed=0;const load=createCatalogLoader();const collection={find(){return {limit(){return this},batchSize(){return this},async toArray(){throw Error('failed')},async close(){closed++}}}};
 await assert.rejects(load(collection));await assert.rejects(load(collection));assert.equal(closed,2);
});
