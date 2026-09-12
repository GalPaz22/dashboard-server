import client from '../../pilot/beautics/client.json' with {type:'json'};
import { processProduct } from '../../pilot/beautics/core.mjs';
import { createSearchService } from '../../pilot/beautics/semantic.mjs';
import { generate } from '../../pilot/beautics/gemini.mjs';

import { createCatalogLoader } from './catalog.mjs';
const loadCatalog=createCatalogLoader();
let lastProducts, service;

export async function searchBeautics({collection, request}) {
  if(request.cursor && service)return service(request);
  let products;
  try { products=await loadCatalog(collection); }
  catch(error) {
    if(!service)throw error;
    const result=await service(request);
    return {...result,metadata:{...result.metadata,catalogStale:true}};
  }
  if (lastProducts !== products) {
    const normalized = products.map(raw => {
      const product = processProduct(raw, client, [], new Date().toISOString());
      // Search must expose the persisted merchant/source badges. The source
      // observer is an enrichment concern; this adapter never drops badges
      // already written by sync or the tenant processor.
      const persisted = Array.isArray(raw.badges) ? raw.badges : [];
      product.badges = persisted.length ? persisted : product.badges;
      product.specialLabel = raw.specialLabel ?? false;
      return product;
    });
    service = createSearchService(normalized, client, generate, {maxCandidates:100,maxEntries:30});
    lastProducts=products;
  }
  return service(request);
}

export {client as beauticsProfile};
