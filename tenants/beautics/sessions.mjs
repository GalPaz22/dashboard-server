import {randomUUID} from 'node:crypto';

const TTL_MS = 30 * 60 * 1000;
const indexes = new WeakMap();
const expired = () => Error('Search expired; start a new search');

// Persist the ranked result snapshot, not a query to rerun against a new catalog.
// Each document holds at most 50 products so broad searches stay below Mongo's
// document size limit. Expiry is enforced on reads as well as by the TTL index.
export function createSearchSessions(collection, {now = Date.now} = {}) {
  async function ready() {
    if (!indexes.has(collection)) {
      const work = collection.createIndex({expiresAt:1}, {expireAfterSeconds:0})
        .catch(error => {indexes.delete(collection);throw error;});
      indexes.set(collection, work);
    }
    await indexes.get(collection);
  }
  function page(result, id, offset, limit) {
    return {...result, nextCursor:offset + limit < result.total ? `snapshot:${id}:${offset + limit}` : null};
  }
  return {
    async save(result, search, limit) {
      if (!result.nextCursor) return result;
      const matches = [...result.matches];
      let cursor = result.nextCursor;
      while (cursor) {
        const next = await search({cursor,limit:50});
        matches.push(...next.matches);
        cursor = next.nextCursor;
      }
      await ready();
      const id = randomUUID(), expiresAt = new Date(now() + TTL_MS);
      const {matches:ignored, nextCursor:ignoredCursor, ...envelope} = result;
      const documents = [];
      for (let offset = 0; offset < matches.length; offset += 50) {
        documents.push({_id:`${id}:${offset / 50}`,expiresAt,envelope:{...envelope,total:matches.length},matches:matches.slice(offset,offset + 50)});
      }
      await collection.insertMany(documents);
      return page({...result,total:matches.length},id,0,limit);
    },
    async read(cursor, limit) {
      if (typeof cursor !== 'string') throw expired();
      const parsed = /^snapshot:([0-9a-f-]{36}):([0-9]+)$/.exec(cursor);
      if (!parsed) throw expired();
      const offset = Number(parsed[2]);
      if (!Number.isSafeInteger(offset) || offset < 1) throw expired();
      const first = Math.floor(offset / 50), last = Math.floor((offset + limit - 1) / 50);
      const docs = await Promise.all(Array.from({length:last-first+1},(_,i) => collection.findOne({_id:`${parsed[1]}:${first+i}`,expiresAt:{$gt:new Date(now())}})));
      const head = docs[0];
      if (!head || offset >= head.envelope.total) throw expired();
      if (docs.some((doc,i) => !doc && (first+i)*50 < head.envelope.total)) throw expired();
      const matches = docs.flatMap(doc => doc?.matches || []).slice(offset % 50,offset % 50 + limit);
      return page({...head.envelope,matches,metadata:{...head.envelope.metadata,cached:true}},parsed[1],offset,limit);
    },
  };
}
