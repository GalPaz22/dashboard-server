// Search logging for the v2 engines (tenants/beautics, tenants/garmin, Semantix tenant modules). They answer /search
// themselves and return before the legacy pipeline's logQuery runs, so without this their searches never reach the
// store's `queries` collection. The legacy pipeline sets no engine header and keeps logging itself.
// An engine marks its response with X-Search-Engine (or X-Semantix-Tenant); a new query (not a cursor page) is then
// logged once, after the response, with the products it returned. Logging never delays or breaks the response.
// searchMeta records how the engine answered (metadata of a modern response: mode, model use, its rewrites), the wall
// time of the request and, when a learned rewrite answered (req.semantixLearned), what was searched instead. onLogged
// then sees the search (learned-rewrites.mjs learns from it).
// It also records why a module answered the way it did, so a report can tell a missing product from rejected candidates,
// a clarification, a failed model call and load (failureReason, alternativesWithheld), and follow the products it showed
// to a click, an add and an order by id (deliveredIds and deliveredQuality beside deliveredProducts' names).
const META={mode:'searchMode',phase:'searchPhase',llmUsed:'llmUsed',elapsedMs:'engineElapsedMs',routerMs:'routerMs',cached:'cached',
 revision:'searchRevision',failureReason:'failureReason',failure:'failure',exactMatch:'exactMatch',fullMatch:'fullMatch',rankedByModel:'rankedByModel',
 closestFallback:'closestFallback',alternativesWithheld:'alternativesWithheld',localFallback:'localFallback',candidateCount:'candidateCount',
 candidatesTruncated:'candidatesTruncated',llmCalls:'llmCalls'};
const short=v=>typeof v==='string'?v.slice(0,120):undefined;
export function searchMeta(body,elapsedMs,learned){
 const m=body&&!Array.isArray(body)&&body.metadata&&typeof body.metadata==='object'?body.metadata:{},out={elapsedMs};
 for(const [from,to] of Object.entries(META))if(m[from]!==undefined&&m[from]!==null&&typeof m[from]!=='object')out[to]=m[from];
 if(typeof body?.status==='string')out.searchStatus=body.status;
 if(typeof m.failureDetail==='string')out.failureDetail=m.failureDetail.slice(0,160);
 // The text searched instead of the typed one (a spelling, keyboard-layout or author correction), kept small.
 const c=m.correction&&typeof m.correction==='object'&&!Array.isArray(m.correction)?m.correction:null;
 if(c&&(short(c.to)||short(c.source)))out.correction={...(short(c.from)&&{from:short(c.from)}),...(short(c.to)&&{to:short(c.to)}),...(short(c.source)&&{source:short(c.source)})};
 if(Array.isArray(m.rewrites)&&m.rewrites.length)out.rewrites=m.rewrites.filter(r=>typeof r==='string').slice(0,3);
 const products=Array.isArray(body)?body:Array.isArray(body?.products)?body.products:Array.isArray(body?.matches)?body.matches:[],shown=products.slice(0,20);
 if(shown.some(p=>p?.id!=null)){out.deliveredIds=shown.map(p=>p?.id==null?null:String(p.id).slice(0,80));
  if(shown.some(p=>typeof p?.matchQuality==='string'))out.deliveredQuality=shown.map(p=>typeof p?.matchQuality==='string'?p.matchQuality:null);}
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
