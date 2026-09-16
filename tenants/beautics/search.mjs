import client from '../../pilot/beautics/client.json' with {type:'json'};
import { processProduct } from '../../pilot/beautics/core.mjs';
import { createSearchService } from '../../pilot/beautics/semantic.mjs';
import { generate } from '../../pilot/beautics/gemini.mjs';

import { createCatalogLoader } from './catalog.mjs';
import { createSearchSessions } from './sessions.mjs';
import { createTopSearch } from './top-search.mjs';
const loadCatalog=createCatalogLoader();
let lastProducts, service;

export async function searchBeautics({collection, sessions, request}) {
  const limit = request.limit ?? 12;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw Error('Invalid limit');
  if (request.cursor && sessions) {
    if (request.query !== undefined) throw Error('Invalid request');
    return createSearchSessions(sessions).read(request.cursor, limit);
  }
  const result = await searchLocal({collection,request});
  // Use the service that produced this result even if another request has
  // refreshed the catalog and replaced the current service in the meantime.
  if (!sessions) return result.result;
  return createSearchSessions(sessions).save(result.result,result.search,limit);
}

async function searchLocal({collection, request}) {
  if(request.cursor) {
    if(!service)throw Error('Search expired; start a new search');
    const search = service;
    return {result:await search(request),search};
  }
  let products;
  try { products=await loadCatalog(collection); }
  catch(error) {
    if(!service)throw error;
    const search = service;
    const result=await search(request);
    return {result:{...result,metadata:{...result.metadata,catalogStale:true}},search};
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
    service = createSearchService(normalized, client, generate, {maxCandidates:100,maxEntries:30,catalogSearch:createTopSearch(normalized,client)});
    lastProducts=products;
  }
  const search = service;
  return {result:await search(request),search};
}

export {client as beauticsProfile};
