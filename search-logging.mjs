// Search logging for the v2 engines (tenants/beautics, tenants/garmin, Semantix tenant modules). They answer /search
// themselves and return before the legacy pipeline's logQuery runs, so without this their searches never reach the
// store's `queries` collection. The legacy pipeline sets no engine header and keeps logging itself.
// An engine marks its response with X-Search-Engine (or X-Semantix-Tenant); a new query (not a cursor page) is then
// logged once, after the response, with the products it returned. Logging never delays or breaks the response.
export function createV2SearchLogger({logQuery,getQueries}){
 return function logV2Search(req,res,next){
  const query=req.body?.query;
  if(typeof query!=='string'||!query.trim()||req.body?.cursor!==undefined)return next();
  const send=res.json.bind(res);
  res.json=body=>{
   try{
    const engine=res.getHeader('X-Search-Engine')||res.getHeader('X-Semantix-Tenant');
    if(engine&&res.statusCode<400&&req.store?.dbName){
     const products=Array.isArray(body)?body:Array.isArray(body?.products)?body.products:Array.isArray(body?.matches)?body.matches:[];
     const total=Number.isFinite(body?.pagination?.totalAvailable)?body.pagination.totalAvailable:Number.isFinite(body?.total)?body.total:products.length;
     Promise.resolve(getQueries(req.store.dbName))
      .then(collection=>logQuery(collection,query,{},products.map(p=>({name:p.name??p.title})),false,{session_id:req.body.session_id,sessionId:req.body.sessionId,zeroResults:total===0,searchEngine:String(engine)}))
      .catch(error=>console.error('[QUERY LOG v2]',error.message));
    }
   }catch(error){console.error('[QUERY LOG v2]',error.message);}
   return send(body);
  };
  next();
 };
}
