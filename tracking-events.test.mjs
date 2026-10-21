import {test} from 'node:test';
import assert from 'node:assert/strict';
import {insertTrackingEvent,hasTrackingEventId} from './tracking-events.mjs';

test('distinct cart actions survive; concurrent retries of one event record once', async()=>{
 const rows=new Map(),collection={async insertOne(row){if(rows.has(row._id)){const e=Error('duplicate');e.code=11000;throw e;}rows.set(row._id,row);return {insertedId:row._id};}};
 const event={event_id:'cart-1',event_type:'add_to_cart',session_id:'vis-123456789',product_id:'woo_product_7'};
 const results=await Promise.all(Array.from({length:5},()=>insertTrackingEvent(collection,event)));
 assert.equal(rows.size,1);assert.equal(results.filter(x=>x.duplicate).length,4);
 await insertTrackingEvent(collection,{...event,event_id:'cart-2'});assert.equal(rows.size,2);
 await insertTrackingEvent(collection,{...event,event_type:'checkout_completed'});assert.equal(rows.size,3);
 assert.equal(hasTrackingEventId({event_id:{$gt:''}}),false);
 await assert.rejects(insertTrackingEvent({insertOne:async()=>{throw Error('offline');}},event),/offline/);
});
