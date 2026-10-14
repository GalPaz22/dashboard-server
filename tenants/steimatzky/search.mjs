import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createDraftRuntime} from './engine/runtime.mjs';
import {processProduct} from './engine/core/core.mjs';
import {hash} from './engine/core/hash.mjs';
import {createSessions} from './sessions.mjs';
const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
export const manifest=read('./semantix.module.json');
const LIVE=["price","regularPrice","stockStatus","hidden","status","url","image"];
const strings=v=>Array.isArray(v)?v.map(x=>typeof x==='string'?x:x?.name).filter(x=>typeof x==='string'):typeof v==='string'&&v?[v]:[];
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
// Merchant-row fields the engine card lacks but a storefront needs: the platform's own item id (add to cart, tracking),
// its catalog number, the subtitle, the sale flag and sale price, the feed's offer id and the per-format price labels
// a card template prints (specialLabel: printed / digital / club). Only these ride along; the engine's own fields win on a clash.
const SOURCE_FIELDS=['ItemID','Makat','Subtitle','onSale','offerId','salePrice','specialLabel'];
const sources=new WeakMap();
export function withSource(rows){
 let byId=sources.get(rows);
 if(!byId){byId=new Map();for(const r of rows){const s={};for(const k of SOURCE_FIELDS)if(r[k]!==undefined&&r[k]!==null)s[k]=r[k];if(Object.keys(s).length)byId.set(String(r.id??r._id),s);}sources.set(rows,byId);}
 return p=>{const s=byId.get(String(p.id))||byId.get(String(p.id).split(':').pop());return s?{...s,...p}:p;};
}
// A merchant Mongo row in the engine's raw shape (as the studio imports existing clients).
export function adaptRow(row){
 return {id:String(row.id??row._id),name:row.name||row.title||'',sku:String(row.sku||''),url:row.url||row.permalink,image:row.image||row.images?.[0]?.src||row.images?.[0]||null,
  price:number(row.price),regularPrice:number(row.regularPrice??row.regular_price),currency:row.currency||null,
  stockStatus:row.stockStatus||row.stock_status||'unknown',status:row.status||'ACTIVE',
  // Hidden as the studio imports it: the store's own flag, "not in store", or a catalog visibility of "hidden".
  hidden:row.hidden===true||row.notInStore===true||row.catalog_visibility==='hidden',
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
// The module's data (approved revision: profile + enriched cards) is published by the studio to the store's own
// database: semantix_module → "<slug>:head" points at a gzip edition stored in parts. The head is one _id lookup,
// checked at most every checkMs; an edition is downloaded only when its digest changes. Local profile.json/snapshot.json
// (a downloaded ZIP) are used only while nothing is published. A failed check keeps serving the edition in memory.
export async function loadEdition(store,head){
 const parts=await store.find({kind:'part',slug:manifest.slug,digest:head.digest}).toArray();
 if(parts.length!==head.parts)throw Error('Published module is incomplete');
 const bytes=v=>v?._bsontype==='Binary'?Buffer.from(v.buffer):Buffer.from(v);
 const gz=Buffer.concat(parts.sort((a,b)=>a.part-b.part).map(p=>bytes(p.data)));
 if(createHash('sha256').update(gz).digest('hex').slice(0,24)!==head.digest)throw Error('Published module is corrupt');
 return {...JSON.parse(gunzipSync(gz).toString('utf8')),digest:head.digest};
}
const local=()=>{const has=n=>existsSync(new URL(n,import.meta.url));return has('./profile.json')&&has('./snapshot.json')?{revision:manifest.revision,profile:read('./profile.json'),snapshot:read('./snapshot.json'),digest:'local'}:null;};
export function createTenantSearch({loadRows,checkMs=30000,now=Date.now}={}){
 let fingerprint=null,runtime=null,edition=null,checkedAt=-Infinity,checking=null;
 async function published(store){
  if(store&&now()-checkedAt>=checkMs)checking??=(async()=>{
   try{const head=await store.findOne({_id:manifest.slug+':head'},{projection:{digest:1,parts:1,revision:1}});
    if(head&&head.digest!==edition?.digest)edition=await loadEdition(store,head);else if(!head&&edition?.digest!=='local')edition=null;checkedAt=now();}
   catch(e){if(!edition)throw e;console.error('[SEMANTIX '+manifest.slug+'] keeping revision',edition.revision,'-',e.message);checkedAt=now();}
   finally{checking=null;}})();
  if(checking)await checking;
  return edition??=local()??(()=>{throw Error('No published module data');})();
 }
 async function current(collection,store){
  const e=await published(store),rows=await loadRows(collection),print=e.digest+':'+hash(rows.map(r=>[r.id??r._id,...LIVE.map(k=>r[k]??r[k==='stockStatus'?'stock_status':k]??null),r.catalog_visibility??null,r.notInStore??null]));
  if(print!==fingerprint||!runtime){
   const cards=mergeLive(e.snapshot.productCards,rows,e.profile,manifest.tenantId),s=e.snapshot;
   runtime=createDraftRuntime({id:manifest.tenantId,url:manifest.url,platform:manifest.platform,productCards:cards,productCardsProfileHash:hash(e.profile),storeContext:s.storeContext,tagAssignments:s.tagAssignments,studioVectors:s.studioVectors,catalog:{products:[]}},{number:e.revision,profile:e.profile});
   runtime.revision=e.revision;fingerprint=print;
  }
  runtime.attach=withSource(rows);
  return runtime;
 }
 // Page size when the storefront sends no limit: the tenant's pipeline.pageSize (published with the profile), else 12.
 const search=async function({collection,sessions,moduleStore,request}){
  const limit=request.limit??(await published(moduleStore)).profile?.pipeline?.pageSize??12;if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('Invalid limit');
  if(request.cursor){if(request.query!==undefined)throw Error('Invalid request');if(!sessions)throw Error('Search expired; start a new search');return createSessions(sessions).read(request.cursor,limit);}
  const rt=await current(collection,moduleStore);let r=await rt.search({query:request.query,limit:50});const matches=[...r.matches];
  while(r.nextCursor&&matches.length<500){r=await rt.search({cursor:r.nextCursor,limit:50});matches.push(...r.matches);}
  const attached=matches.map(rt.attach),result={...r,matches:attached,total:matches.length,nextCursor:null,metadata:{...r.metadata,searchEngine:'semantix-'+manifest.slug,revision:rt.revision}};
  return sessions?createSessions(sessions).save(result,limit):{...result,matches:attached.slice(0,limit)};
 };
 // Suggestions while the shopper types: the same edition and live rows as search, answered from the index only.
 search.suggest=async({collection,moduleStore,query,limit})=>{
  const rt=await current(collection,moduleStore);if(typeof rt.suggest!=='function')throw Error('Engine has no suggestions; export the module again');
  const r=await rt.suggest(query,{limit});return {...r,matches:r.matches.map(rt.attach),revision:rt.revision};
 };
 return search;
}
// Default Mongo loader: the merchant's products collection, cached for a minute.
export function createRowLoader({ttlMs=60000,now=Date.now,max=60000}={}){
 let cached=null,expires=0,pending=null;
 return async collection=>{
  if(cached&&now()<expires)return cached;if(pending)return pending;
  pending=(async()=>{const cursor=collection.find({},{projection:{_id:1,id:1,name:1,title:1,sku:1,url:1,permalink:1,image:1,images:1,price:1,regularPrice:1,regular_price:1,currency:1,stockStatus:1,stock_status:1,status:1,hidden:1,notInStore:1,catalog_visibility:1,categories:1,category:1,tags:1,siteTags:1,description:1,short_description:1,specifications:1,...Object.fromEntries(SOURCE_FIELDS.map(k=>[k,1]))},maxTimeMS:20000}).limit(max+1).batchSize(500);
   try{const rows=await cursor.toArray();if(rows.length>max)throw Error('Catalog exceeds safety limit');cached=rows;expires=now()+ttlMs;return rows;}finally{await cursor.close?.();}})();
  try{return await pending;}finally{pending=null;}
 };
}
