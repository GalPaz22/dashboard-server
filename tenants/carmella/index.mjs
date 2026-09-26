import {createTenantSearch,createRowLoader,manifest} from './search.mjs';
export {manifest};
// Same contract as tenants/garmin/routes.mjs: middleware for POST /search and GET /search/load-more.
// The registry decides whether this tenant answers (control document, rollout, circuit breaker); with onError set, a
// failed new search falls through to the existing pipeline instead of returning an error to the shopper.
export function storefrontResponse(result,modern=true){
 const products=(result.matches||[]).map(p=>({...p,name:p.title??p.name,badges:p.badges||[]}));
 if(!modern)return products;
 const token=result.nextCursor?manifest.tokenPrefix+result.nextCursor:null;
 return {...result,matches:products,products,metadata:{...result.metadata,searchEngine:'semantix-'+manifest.slug},pagination:{totalAvailable:result.total,returned:products.length,hasMore:!!token,nextToken:token,nextCursor:result.nextCursor,secondBatchToken:null,categoryFilterToken:null,hasCategoryFiltering:false}};
}
export function createTenantRoutes({getDb,search=createTenantSearch({loadRows:createRowLoader()}),enabled=()=>String(process.env.SEMANTIX_TENANTS||'').split(',').map(s=>s.trim()).includes(manifest.slug),onError=null,onServed=()=>{}}={}){
 const mine=req=>!!manifest.dbName&&req.store?.dbName===manifest.dbName;
 async function send(req,res,next,request,modern,fresh){
  const limit=Number(request.limit??12);
  if(!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({error:'Invalid limit'});
  if(request.cursor?typeof request.cursor!=='string'||!request.cursor:typeof request.query!=='string'||!request.query.trim()||request.query.length>300)return res.status(400).json({error:'Invalid request'});
  try{const db=await getDb(manifest.dbName);const result=await search({collection:db.collection(req.store.products||manifest.collection||'products'),sessions:db.collection('semantix_'+manifest.slug.replace(/-/g,'_')+'_sessions'),request:{...request,limit}});
   res.setHeader('X-Semantix-Tenant',manifest.slug+'@'+manifest.revision);if(result.nextCursor)res.setHeader('X-Next-Token',manifest.tokenPrefix+result.nextCursor);onServed();return res.json(storefrontResponse(result,modern));}
  catch(error){if(error.message==='Search expired; start a new search'||error.message==='Invalid cursor')return res.status(410).json({error:'Search expired; start a new search'});
   console.error('[SEMANTIX '+manifest.slug+']',error.message);
   if(onError){onError(error);if(fresh&&!res.headersSent)return next();}
   return res.status(503).json({error:'Search temporarily unavailable',retryable:true,metadata:{searchEngine:'semantix-'+manifest.slug}});}
 }
 return {
  manifest,
  search(req,res,next){if(!mine(req)||!enabled(req))return next();if(req.body.cursor!==undefined&&req.body.query!==undefined)return res.status(400).json({error:'Cursor cannot be combined with query'});
   const fresh=req.body.cursor===undefined,request=fresh?{query:req.body.query,limit:req.body.limit}:{cursor:req.body.cursor,limit:req.body.limit};return send(req,res,next,request,req.body.modern===true||req.body.modern==='true',fresh);},
  // Our own paging tokens are always served while the module is loaded, even if it was just switched off.
  loadMore(req,res,next){const token=req.query.token;if(typeof token!=='string'||!token.startsWith(manifest.tokenPrefix))return next();if(!mine(req))return res.status(400).json({error:'Invalid pagination token'});return send(req,res,next,{cursor:token.slice(manifest.tokenPrefix.length),limit:req.query.limit??20},true,false);}
 };
}
