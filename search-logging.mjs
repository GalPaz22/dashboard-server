// Search logging for the v2 engines (tenants/beautics, tenants/garmin, Semantix tenant modules). They answer /search
// themselves and return before the legacy pipeline's logQuery runs, so without this their searches never reach the
// store's `queries` collection. The legacy pipeline sets no engine header and keeps logging itself.
// An engine marks its response with X-Search-Engine (or X-Semantix-Tenant); a new query (not a cursor page) is then
// logged once, after the response, with the products it returned. Logging never delays or breaks the response.
// searchMeta records how the engine answered (metadata of a modern response: mode, model use, its rewrites), the wall
// time of the request and, when a learned rewrite answered (req.semantixLearned), what was searched instead. onLogged
// then sees the search (learned-rewrites.mjs learns from it).
const META={mode:'searchMode',phase:'searchPhase',llmUsed:'llmUsed',elapsedMs:'engineElapsedMs',routerMs:'routerMs',cached:'cached'};
export function searchMeta(body,elapsedMs,learned){
 const m=body&&!Array.isArray(body)&&body.metadata&&typeof body.metadata==='object'?body.metadata:{},out={elapsedMs};
 for(const [from,to] of Object.entries(META))if(m[from]!==undefined&&m[from]!==null)out[to]=m[from];
 if(Array.isArray(m.rewrites)&&m.rewrites.length)out.rewrites=m.rewrites.filter(r=>typeof r==='string').slice(0,3);
 if(learned)out.learnedRewrite=learned.rewrite;
 return out;
}
export function createV2SearchLogger({logQuery,getQueries,onLogged=null,now=Date.now}){
 return function logV2Search(req,res,next){
  const query=req.body?.query;
  if(req.get?.('X-Semantix-Preview')==='dashboard')return next();
  if(typeof query!=='string'||!query.trim()||req.body?.cursor!==undefined)return next();
  const send=res.json.bind(res),started=now();
  res.json=body=>{
   try{
    const engine=res.getHeader('X-Search-Engine')||res.getHeader('X-Semantix-Tenant');
    if(engine&&res.statusCode<400&&req.store?.dbName){
     const products=Array.isArray(body)?body:Array.isArray(body?.products)?body.products:Array.isArray(body?.matches)?body.matches:[];
     const total=Number.isFinite(body?.pagination?.totalAvailable)?body.pagination.totalAvailable:Number.isFinite(body?.total)?body.total:products.length;
     const dbName=req.store.dbName,learned=req.semantixLearned,meta=searchMeta(body,now()-started,learned);
     Promise.resolve(getQueries(dbName))
      .then(collection=>logQuery(collection,query,{},products.map(p=>({name:p.name??p.title})),false,{session_id:req.body.session_id,sessionId:req.body.sessionId,...(req.body.search_id&&{search_id:req.body.search_id}),...(req.body.visit_id&&{visit_id:req.body.visit_id}),...(req.body.ab_tests&&{ab_tests:req.body.ab_tests}),zeroResults:total===0,searchEngine:String(engine),searchMeta:meta}))
      .then(()=>onLogged?.(dbName,{query,metadata:body?.metadata,zeroResults:total===0,learned}))
      .catch(error=>console.error('[QUERY LOG v2]',error.message));
    }
   }catch(error){console.error('[QUERY LOG v2]',error.message);}
   return send(body);
  };
  next();
 };
}
