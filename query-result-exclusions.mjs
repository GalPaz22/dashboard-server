// Rule conditions select the exact query before these ids reach the response.
export function filterExcludedProducts(payload,ids=[]){
 if(!ids?.length)return payload;const excluded=new Set(ids.map(String));
 const keep=p=>![p?._id,p?.id,p?.product_id].filter(x=>x!=null).some(x=>excluded.has(String(x))||excluded.has(String(x).split(':').pop()));
 if(Array.isArray(payload))return payload.filter(keep);
 if(payload&&Array.isArray(payload.products)){const products=payload.products.filter(keep);return {...payload,products,...(typeof payload.count==='number'?{count:products.length}:{})};}
 return payload;
}
