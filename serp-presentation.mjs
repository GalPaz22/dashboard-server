const plain=value=>String(value??'').replace(/[<>\u0000-\u001f]/g,'').slice(0,500);
const ids=p=>[p?._id,p?.id,p?.productId,p?.sku].filter(v=>v!=null).flatMap(v=>[String(v),String(v).split(':').pop()]);
// Presentation is data, never HTML. Legacy clients already show `explanation`;
// current widgets also render safe, individual links for complementary items.
export function applySerpPresentation(payload,store={}){
 const apply=list=>{
  const demoted=new Set((store.demotedProductIds||[]).map(String));
  const find=id=>list.find(p=>ids(p).includes(String(id)));
  return list.map((p,index)=>{
   const note=(store.productNotes||[]).find(n=>ids(p).includes(String(n.productId)));
   const groups=(store.productBundles||[]).filter(b=>ids(p).some(id=>b.productIds.map(String).includes(id))).map(b=>({title:b.title,products:b.productIds.map(find).filter(Boolean).filter(other=>!ids(other).some(id=>ids(p).includes(id))).map(other=>({id:String(other.id??other._id),name:other.name||other.title,url:other.url||other.permalink,price:other.price,currency:other.currency}))})).filter(b=>b.products.length);
   const text=[note?.text,...groups.map(b=>`${plain(b.title)}: ${b.products.map(other=>plain(other.name)).join(' + ')}`)].filter(Boolean).map(plain).join(' · ');
   return {p:{...p,...(text?{explanation:text}:{}),...(groups.length?{complementaryProducts:groups}: {})},index,demoted:ids(p).some(id=>demoted.has(id))};
  }).sort((a,b)=>Number(a.demoted)-Number(b.demoted)||a.index-b.index).map(x=>x.p);
 };
 if(Array.isArray(payload))return apply(payload);
 if(payload&&Array.isArray(payload.products))return {...payload,products:apply(payload.products)};
 if(payload&&Array.isArray(payload.matches))return {...payload,matches:apply(payload.matches)};
 return payload;
}
