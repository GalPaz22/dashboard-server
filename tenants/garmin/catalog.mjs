const fields=['id','name','title','sku','url','permalink','image','price','regularPrice','regular_price','currency','stockStatus','stock_status','hidden','status','categories','category','tags','siteTags','colors','badges','description','short_description','specifications'];
export const projection=Object.fromEntries(fields.map(f=>[f,1]));projection._id=0;
const strings=values=>Array.isArray(values)?values.map(v=>typeof v==='string'?v:v?.name).filter(v=>typeof v==='string'):[];
const number=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
export function adaptProduct(raw){
 return {...raw,id:String(raw.id),name:raw.name||raw.title||'',sku:String(raw.sku||''),raw:{sku:String(raw.sku||'')},url:raw.url||raw.permalink,
  categories:strings(raw.categories?.length?raw.categories:raw.category),tags:[...new Set([...strings(raw.tags),...strings(raw.siteTags)])],colors:strings(raw.colors),
  price:number(raw.price),regularPrice:number(raw.regularPrice??raw.regular_price),currency:raw.currency||'ILS',
  status:raw.status||'ACTIVE',stockStatus:raw.stockStatus||raw.stock_status||'unknown',
  description:String(raw.description||raw.short_description||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,18000)};
}
export function createCatalogLoader({ttlMs=60000,now=Date.now}={}){
 let cached,expires=0,pending;
 return async collection=>{
  if(cached&&now()<expires)return cached;if(pending)return pending;
  pending=(async()=>{const cursor=collection.find({}, {projection,maxTimeMS:15000}).limit(10000).batchSize(100);try{const rows=await cursor.toArray();if(rows.length>=10000)throw Error('Garmin catalog exceeds safety limit');cached=rows.map(adaptProduct);expires=now()+ttlMs;return cached;}finally{await cursor.close();}})();
  try{return await pending;}finally{pending=null;}
 };
}
