// Learned rewrites for the Semantix tenant modules. A query the module could answer only by asking the model to respell
// it (metadata.mode 'llm-lexical': "מטען לאוטו" → "מטען לרכב") is answered next time by searching the respelling
// straight away: a lexical search, no model call, no wait. Kept per store in its own database (semantix_learned_rewrites,
// _id = the normalized query), so it survives restarts and rebuilds, and an operator can list or revoke it.
//
// Lifecycle, decided only from what shoppers did (nothing here asks a model):
//   candidate → the model respelled the query once; every later identical respelling is counted (agree).
//   active    → on a repeat of the query: a shopper clicked or added to cart after one of its searches, or the model gave
//               the same respelling `promoteSearches` times in a row. From then on the respelling is searched directly.
//   revoked   → a search served by the respelling returned nothing, or `revokeAfterServed` served searches brought no
//               click or cart at all. A revoked query goes back to the model and is never promoted again automatically.
// Engagement is read from product_click_events and cart by session, inside `engageWindowMs` after the search. A failed
// read is "unknown": it never promotes by engagement and never revokes.
export const COLLECTION='semantix_learned_rewrites';
export const RULES={promoteSearches:3,engageWindowMs:30*60e3,lookbackMs:30*864e5,reviewEvery:5,revokeAfterServed:10};
export const normalizeQuery=q=>String(q??'').normalize('NFKC').toLowerCase().replace(/[?!.,;:"״“”]+/g,' ').replace(/\s+/g,' ').trim();

export function createLearnedRewrites({getDb,now=Date.now,cacheMs=60000,rules=RULES,log=console}={}){
 const cache=new Map();
 const collection=async dbName=>(await getDb(dbName)).collection(COLLECTION);
 async function active(dbName){
  const hit=cache.get(dbName);if(hit&&now()-hit.at<cacheMs)return hit.map;
  const rows=await (await collection(dbName)).find({status:'active'},{projection:{rewrite:1}}).limit(5000).toArray();
  const map=new Map(rows.map(r=>[r._id,r.rewrite]));cache.set(dbName,{at:now(),map});return map;
 }
 const date=v=>{const d=v instanceof Date?v:new Date(v);return Number.isFinite(d.getTime())?d:null;};
 // Sessions with a click or cart within the window after one of the query's searches (null when it cannot be read).
 async function engagedSessions(dbName,query,filter,since){
  try{
   const db=await getDb(dbName),keys=new Set([normalizeQuery(query),...(filter.rewrite?[normalizeQuery(filter.rewrite)]:[])]);
   const searches=(await db.collection('queries').find({query,timestamp:{$gte:since},...filter.match},{projection:{session_id:1,timestamp:1},maxTimeMS:3000}).sort({timestamp:-1}).limit(200).toArray())
    .map(s=>({session:s.session_id,at:date(s.timestamp)})).filter(s=>s.session&&s.at);
   if(!searches.length)return 0;
   const sessions=[...new Set(searches.map(s=>s.session))].slice(0,100),opts={projection:{session_id:1,timestamp:1,query:1,search_query:1},maxTimeMS:3000};
   const [clicks,carts]=await Promise.all([
    db.collection('product_click_events').find({session_id:{$in:sessions},timestamp:{$gte:since}},opts).limit(2000).toArray(),
    db.collection('cart').find({session_id:{$in:sessions}},opts).limit(2000).toArray()]);
   const engaged=new Set();
   for(const e of [...clicks,...carts]){
    const at=date(e.timestamp),q=e.query??e.search_query;if(!at||(q&&!keys.has(normalizeQuery(q))))continue;
    if(searches.some(s=>s.session===e.session_id&&at>=s.at&&at-s.at<=rules.engageWindowMs))engaged.add(e.session_id);
   }
   return engaged.size;
  }catch(error){log.error('[LEARNED REWRITES] engagement read failed',dbName,error.message);return null;}
 }
 async function setStatus(dbName,query,status,reason){
  const at=new Date(now()),set={status,reason,[status==='active'?'promotedAt':'revokedAt']:at,...(status==='active'&&{served:0})};
  const r=await (await collection(dbName)).updateOne({_id:normalizeQuery(query)},{$set:set});cache.delete(dbName);
  log.log('[LEARNED REWRITES]',dbName,status,JSON.stringify(query),'('+reason+')');return r.matchedCount>0;
 }
 // One logged search: called after the queries document is written.
 async function observe(dbName,{query,metadata,zeroResults,learned}){
  const col=await collection(dbName),at=new Date(now());
  if(learned){
   const id=normalizeQuery(learned.query),doc=await col.findOneAndUpdate({_id:id,status:'active'},{$inc:{served:1},$set:{lastServedAt:at}},{returnDocument:'after'});
   const row=doc?.value===undefined?doc:doc.value;if(!row)return;
   if(zeroResults)return setStatus(dbName,learned.query,'revoked','zero-results');
   if(row.served>=rules.revokeAfterServed&&row.served%rules.reviewEvery===0){
    const engaged=await engagedSessions(dbName,learned.query,{match:{learnedRewrite:row.rewrite}},row.promotedAt);
    if(engaged===0)return setStatus(dbName,learned.query,'revoked','no-engagement');
   }
   return;
  }
  const rewrite=metadata?.mode==='llm-lexical'&&Array.isArray(metadata.rewrites)&&typeof metadata.rewrites[0]==='string'?metadata.rewrites[0].trim():'';
  const id=normalizeQuery(query);
  if(!rewrite||!id||normalizeQuery(rewrite)===id)return;
  const doc=await col.findOne({_id:id});
  if(!doc){try{await col.insertOne({_id:id,query,rewrite,status:'candidate',seen:1,agree:1,firstSeenAt:at,lastSeenAt:at});}catch(error){if(error.code!==11000)throw error;}return;}
  const agree=doc.rewrite===rewrite?(doc.agree||1)+1:1;
  await col.updateOne({_id:id},{$set:{rewrite,agree,lastSeenAt:at},$inc:{seen:1}});
  if(doc.status!=='candidate')return;
  const since=new Date(Math.max(date(doc.firstSeenAt)?.getTime()||0,now()-rules.lookbackMs));
  const engaged=await engagedSessions(dbName,query,{match:{searchMode:'llm-lexical'},rewrite},since);
  if(engaged>0||agree>=rules.promoteSearches)await setStatus(dbName,query,'active',engaged>0?'engagement':'repeated-rewrite');
 }
 return {
  observe,setStatus,
  async list(dbName,{status}={}){return (await collection(dbName)).find(status?{status}:{}).sort({lastSeenAt:-1}).limit(500).toArray();},
  // Before the module chain: a store whose module is on searches an active rewrite instead of what was typed.
  async apply(req,_res,next){
   try{
    const query=req.body?.query,dbName=req.store?.dbName;
    if(typeof query==='string'&&query.trim()&&req.body.cursor===undefined&&dbName&&req.store?.semantix?.enabled===true){
     const rewrite=(await active(dbName)).get(normalizeQuery(query));
     if(rewrite){req.semantixLearned={query,rewrite};req.body.query=rewrite;}
    }
   }catch(error){log.error('[LEARNED REWRITES] lookup failed',error.message);}
   next();
  },
  // After the module chain: a search the module did not answer (switched off, rollout bucket, failure) goes on with
  // what the shopper typed, so the other pipelines and any A/B comparison are untouched.
  restore(req,_res,next){if(req.semantixLearned){req.body.query=req.semantixLearned.query;delete req.semantixLearned;}next();}
 };
}
