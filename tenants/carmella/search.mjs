import {readFileSync} from 'node:fs';
import {createDraftRuntime} from './engine/runtime.mjs';
import {processProduct} from './engine/core/core.mjs';
import {hash} from './engine/core/hash.mjs';
import {createSessions} from './sessions.mjs';
const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
export const manifest=read('./semantix.module.json');
const LIVE=["price","regularPrice","stockStatus","hidden","status","url","image"];
const strings=v=>Array.isArray(v)?v.map(x=>typeof x==='string'?x:x?.name).filter(x=>typeof x==='string'):typeof v==='string'&&v?[v]:[];
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
// A merchant Mongo row in the engine's raw shape (as the studio imports existing clients).
export function adaptRow(row){
 return {id:String(row.id??row._id),name:row.name||row.title||'',sku:String(row.sku||''),url:row.url||row.permalink,image:row.image||row.images?.[0]?.src||row.images?.[0]||null,
  price:number(row.price),regularPrice:number(row.regularPrice??row.regular_price),currency:row.currency||null,
  stockStatus:row.stockStatus||row.stock_status||'unknown',status:row.status||'ACTIVE',hidden:row.hidden===true,
  categories:strings(row.categories?.length?row.categories:row.category),tags:[...new Set([...strings(row.tags),...strings(row.siteTags)])],
  description:String(row.description||row.short_description||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,18000),specifications:row.specifications&&typeof row.specifications==='object'&&!Array.isArray(row.specifications)?row.specifications:{}};
}
// Enriched snapshot cards with live commercial fields; new products are processed with the same profile.
export function mergeLive(cards,rows,profile,tenantId){
 const live=new Map(rows.map(r=>{const a=adaptRow(r);return [a.id,a];})),out=[],seen=new Set();
 for(const c of cards){const key=String(c.id).split(':').pop(),row=live.get(String(c.id))||live.get(key);if(!row)continue;seen.add(row.id);
  const next={...c};for(const k of LIVE)if(row[k]!==undefined&&row[k]!==null)next[k]=row[k];out.push(next);}
 const client={...profile,tenantId,version:'semantix-mini',publishedStatuses:['ACTIVE','publish']};
 for(const [id,row] of live)if(!seen.has(id))out.push(processProduct(row,client));
 return out;
}
export function createTenantSearch({loadRows}={}){
 const profile=read('./profile.json'),snapshot=read('./snapshot.json');let fingerprint=null,runtime=null;
 async function current(collection){
  const rows=await loadRows(collection),print=hash(rows.map(r=>[r.id??r._id,...LIVE.map(k=>r[k]??r[k==='stockStatus'?'stock_status':k]??null)]));
  if(print!==fingerprint||!runtime){
   const cards=mergeLive(snapshot.productCards,rows,profile,manifest.tenantId);
   runtime=createDraftRuntime({id:manifest.tenantId,url:manifest.url,platform:manifest.platform,productCards:cards,productCardsProfileHash:hash(profile),storeContext:snapshot.storeContext,tagAssignments:snapshot.tagAssignments,studioVectors:snapshot.studioVectors,catalog:{products:[]}},{number:manifest.revision,profile});
   fingerprint=print;
  }
  return runtime;
 }
 return async function search({collection,sessions,request}){
  const limit=request.limit??12;if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('Invalid limit');
  if(request.cursor){if(request.query!==undefined)throw Error('Invalid request');if(!sessions)throw Error('Search expired; start a new search');return createSessions(sessions).read(request.cursor,limit);}
  const rt=await current(collection);let r=await rt.search({query:request.query,limit:50});const matches=[...r.matches];
  while(r.nextCursor&&matches.length<500){r=await rt.search({cursor:r.nextCursor,limit:50});matches.push(...r.matches);}
  const result={...r,matches,total:matches.length,nextCursor:null,metadata:{...r.metadata,searchEngine:'semantix-'+manifest.slug,revision:manifest.revision}};
  return sessions?createSessions(sessions).save(result,limit):{...result,matches:matches.slice(0,limit)};
 };
}
// Default Mongo loader: the merchant's products collection, cached for a minute.
export function createRowLoader({ttlMs=60000,now=Date.now,max=60000}={}){
 let cached=null,expires=0,pending=null;
 return async collection=>{
  if(cached&&now()<expires)return cached;if(pending)return pending;
  pending=(async()=>{const cursor=collection.find({},{projection:{_id:1,id:1,name:1,title:1,sku:1,url:1,permalink:1,image:1,images:1,price:1,regularPrice:1,regular_price:1,currency:1,stockStatus:1,stock_status:1,status:1,hidden:1,categories:1,category:1,tags:1,siteTags:1,description:1,short_description:1,specifications:1},maxTimeMS:20000}).limit(max+1).batchSize(500);
   try{const rows=await cursor.toArray();if(rows.length>max)throw Error('Catalog exceeds safety limit');cached=rows;expires=now()+ttlMs;return rows;}finally{await cursor.close?.();}})();
  try{return await pending;}finally{pending=null;}
 };
}
