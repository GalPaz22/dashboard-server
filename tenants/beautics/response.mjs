// Keep the storefront's product and envelope fields alongside the pilot contract.
export function storefrontResponse(result, modern) {
  const products=(result.matches || []).map(p=>({...p,name:p.title ?? p.name,badges:p.badges || []}));
  if(!modern)return products;
  return {...result,matches:products,products,metadata:{...result.metadata,searchEngine:'beautics-v2'},
    pagination:{totalAvailable:result.total,returned:products.length,batchNumber:1,
      hasMore:!!result.nextCursor,nextToken:null,nextCursor:result.nextCursor,
      secondBatchToken:null,categoryFilterToken:null,hasCategoryFiltering:false}};
}
