import {searchGarmin} from './search.mjs';
export function storefrontResponse(result,modern=true){
 const products=(result.matches||[]).map(p=>({...p,name:p.title??p.name,badges:p.badges||[]}));
 if(!modern)return products;
 return {...result,matches:products,products,metadata:{...result.metadata,searchEngine:'garmin-v2'},pagination:{totalAvailable:result.total,returned:products.length,hasMore:!!result.nextCursor,nextToken:result.nextCursor?'garmin-v2:'+result.nextCursor:null,nextCursor:result.nextCursor,secondBatchToken:null,categoryFilterToken:null,hasCategoryFiltering:false}};
}
export function createGarminRoutes({getDb,search=searchGarmin,enabled=()=>process.env.GARMIN_SEARCH_V2==='true'}){
 async function send(req,res,request,modern){
  const limit=Number(request.limit??12);
  if(!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({error:'Invalid limit'});
  if(request.cursor?typeof request.cursor!=='string'||!request.cursor:typeof request.query!=='string'||!request.query.trim()||request.query.length>300)return res.status(400).json({error:'Invalid request'});
  try{const db=await getDb();const result=await search({collection:db.collection(req.store.products||'products'),sessions:db.collection('garmin_search_sessions'),request:{...request,limit}});if(result.nextCursor)res.setHeader('X-Next-Token','garmin-v2:'+result.nextCursor);return res.json(storefrontResponse(result,modern));}
  catch(error){if(error.message==='Search expired; start a new search'||error.message==='Invalid cursor')return res.status(410).json({error:'Search expired; start a new search'});console.error('[GARMIN V2]',error.message);return res.status(503).json({error:'Search temporarily unavailable',retryable:true,metadata:{searchEngine:'garmin-v2'}});}
 }
 return {
  search(req,res,next){if(!enabled()||req.store?.dbName!=='garmin')return next();if(req.body.cursor!==undefined&&req.body.query!==undefined)return res.status(400).json({error:'Cursor cannot be combined with query'});const request=req.body.cursor!==undefined?{cursor:req.body.cursor,limit:req.body.limit}:{query:req.body.query,limit:req.body.limit};return send(req,res,request,req.body.modern===true||req.body.modern==='true');},
  loadMore(req,res,next){const token=req.query.token;if(typeof token!=='string'||!token.startsWith('garmin-v2:'))return next();if(req.store?.dbName!=='garmin')return res.status(400).json({error:'Invalid pagination token'});return send(req,res,{cursor:token.slice(10),limit:req.query.limit??20},true);}
 };
}
