import client from '../../pilot/beautics/client.json' with {type:'json'};
import { processProduct } from '../../pilot/beautics/core.mjs';
import { createSearchService } from '../../pilot/beautics/semantic.mjs';
import { generate } from '../../pilot/beautics/gemini.mjs';

const services = new Map();

export async function searchBeautics({products, request}) {
  const key = `${client.tenantId}:${products.length}`;
  let service = services.get(key);
  if (!service) {
    const normalized = products.map(p => processProduct(p, client, [], new Date().toISOString()));
    service = createSearchService(normalized, client, generate, {maxCandidates:100});
    services.clear();
    services.set(key, service);
  }
  return service(request);
}

export {client as beauticsProfile};
