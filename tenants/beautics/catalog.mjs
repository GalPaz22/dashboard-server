// Only public fields needed by the tenant search pipeline; never load embeddings.
export const projection = Object.fromEntries(['id','name','title','url','image','price','regularPrice','currency','stockStatus','hidden','status','categories','tags','colors','specialLabel','badges','fetchedAt','raw.sku'].map(field=>[field,1]));
projection._id=0;

export function createCatalogLoader({ttlMs=60000, now=Date.now}={}) {
  let cached, expires=0, pending;
  return async function load(collection) {
    if(cached && now()<expires)return cached;
    if(pending)return pending;
    pending=(async()=>{
      const cursor=collection.find({}, {projection,maxTimeMS:15000}).limit(10000).batchSize(100);
      try {
        const products=await cursor.toArray();
        if(products.length>=10000)throw Error('Beautics catalog exceeds safety limit');
        cached=products; expires=now()+ttlMs;
        return cached;
      } finally {await cursor.close();}
    })();
    try{return await pending;}finally{pending=null;}
  };
}
