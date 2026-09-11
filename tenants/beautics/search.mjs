import client from '../../pilot/beautics/client.json' with {type:'json'};
import { processProduct } from '../../pilot/beautics/core.mjs';
import { createSearchService } from '../../pilot/beautics/semantic.mjs';
import { generate } from '../../pilot/beautics/gemini.mjs';

const services = new Map();

export async function searchBeautics({products, request}) {
  const key = `${client.tenantId}:${products.length}`;
  let service = services.get(key);
  if (!service) {
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
    service = createSearchService(normalized, client, generate, {maxCandidates:100});
    services.clear();
    services.set(key, service);
  }
  return service(request);
}

export {client as beauticsProfile};
