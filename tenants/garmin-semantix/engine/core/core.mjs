import { createHash } from 'node:crypto';

// Tenant stock policy (pipeline.outOfStock): "hide" (default) shows only in-stock products; "last" also shows out-of-stock
// ones after all in-stock results; "show" shows them in their natural place. Hidden products are never shown.
export const stockPolicy=client=>['last','show'].includes(client?.pipeline?.outOfStock)?client.pipeline.outOfStock:'hide';
export const sellable=(p,client)=>!!p&&!p.hidden&&(p.stockStatus==='instock'||stockPolicy(client)!=='hide');
export const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase()
  .normalize('NFD').replace(/\p{M}/gu,'').replace(/[®™]/g,'')
  .replace(/[׳״'’`"“”„«»″‟]/g, '').replace(/[-–—()[\],:;!?]/g, ' ').replace(/\s+/g, ' ').trim();
const list = value => Array.isArray(value) ? value.filter(x => typeof x === 'string') : [];
export function productUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.hostname.replace(/^www\./, '') + decodeURIComponent(u.pathname).replace(/\/$/, '');
  } catch { return null; }
}

export function processProduct(raw, client, observations = [], observedAt = null) {
  const categories = list(raw.categories), tags = list(raw.tags);
  const badgeCandidates = Object.entries(client.badgeCandidates).flatMap(([field, values]) =>
    list(raw[field]).filter(v => values.includes(v)).map(text => ({text, sourceField: field, status: 'needs-verification'})));
  const types = Object.entries(client.productTypes).filter(([, rule]) => rule.categories.some(c => categories.includes(c)));
  const colors = Object.entries(client.colors).filter(([color, cats]) =>
    list(raw.colors).includes(color) || cats.some(c => categories.includes(c))).map(([color]) => color);
  const finishes = Object.entries(client.finishes || {}).filter(([, rule]) => rule.categories.some(c => categories.includes(c))).map(([key]) => key);
  const evidence = observations.filter(o => productUrl(raw.url) && productUrl(o.url) === productUrl(raw.url));
  const badges = [], issues = [];
  for (const item of evidence.flatMap(o => o.badges)) {
    if (item.kind === 'stock' && raw.stockStatus !== 'outofstock') {
      issues.push('source-stock-conflict'); continue;
    }
    if (item.kind === 'sale' && !(Number.isFinite(raw.regularPrice) && Number.isFinite(raw.price) && raw.regularPrice > raw.price)) {
      issues.push('source-sale-conflict'); continue;
    }
    if (!badges.some(b => b.kind === item.kind && b.text === item.text)) {
      const observation = evidence.find(o => o.badges.includes(item));
      badges.push({...item, origin: 'source-dom', sourceUrl: observation?.sourceUrl || client.sourceUrl, productUrl: raw.url, observedAt: observation?.observedAt || observedAt});
    }
  }
  if (types.length > 1) issues.push('ambiguous-product-type');
  for (const candidate of badgeCandidates) {
    if (badges.some(b => b.text === candidate.text)) candidate.status = 'observed-on-product';
  }
  if (raw.specialLabel === true) issues.push('legacy-label-without-meaning');
  return {
    id: String(raw.id), tenantId: client.tenantId, schemaVersion: client.version,
    title: raw.name || raw.title || '', description:raw.description||'', specifications:raw.specifications||{}, sku: String(raw.raw?.sku || ''), url: raw.url,
    image: raw.image, price: Number.isFinite(raw.price) ? raw.price : null,
    regularPrice: Number.isFinite(raw.regularPrice) ? raw.regularPrice : null,
    currency: raw.currency || null, stockStatus: raw.stockStatus || 'unknown',
    hidden: raw.hidden === true || !client.publishedStatuses.includes(raw.status),
    productType: types.length === 1 ? types[0][0] : null, colors, finishes, categories, tags,
    badges, badgeCandidates, issues,
    provenance: {productType: 'categories', colors: ['categories', 'colors'], finishes: 'categories', fetchedAt: raw.fetchedAt || null},
  };
}

// Tenant typo corrections; keys may be phrases ("מאיר שליו"), longest first, whole words only.
export function applySpelling(query, aliases = {}) {
  let text = ` ${normalize(query)} `;
  for (const [from, to] of Object.entries(aliases || {}).map(([f, t]) => [normalize(f), normalize(t)]).filter(([f]) => f).sort((a, b) => b[0].length - a[0].length))
    while (text.includes(` ${from} `)) text = text.replace(` ${from} `, ` ${to} `);
  return text.trim();
}
export function planQuery(query, client) {
  const spelled = applySpelling(query, client.queryAliases);
  let remaining = ` ${spelled} `;
  const plan = {strategy: 'lexical', productType: null, colors: [], finishes: [], tags: [], maxPrice: null, terms: []};
  if (spelled !== normalize(query)) plan.spelling = {from: normalize(query), to: spelled, source: 'tenant-alias'};
  for(const rule of [...(client.scopedAliases||[])].sort((a,b)=>b.term.length-a.term.length)){
    const term=normalize(rule.term);if(term&&remaining.includes(` ${term} `)){
      (plan.scopedAliases??=[]).push(rule);
      plan.scopedProductIds=plan.scopedProductIds?plan.scopedProductIds.filter(id=>rule.productIds.includes(id)):[...rule.productIds];
      remaining=remaining.replace(` ${term} `,' ');
    }
  }
  const price = remaining.match(/עד\s+(\d+(?:\.\d+)?)\s*(?:שקל(?:ים)?|שח|₪)?/);
  if (price) { plan.maxPrice = Number(price[1]); remaining = remaining.replace(price[0], ' '); }
  // Tenant-defined tags (e.g. an attribute an operator asked to find/mark,
  // like "square screen") are matched by their own label plus any declared
  // alias phrasing, independent of whether that wording ever appears in a
  // product title — the tag was assigned to matching products separately.
  for (const [tag, rule] of Object.entries(client.tagDefinitions || {})) {
    const aliases = [normalize(tag), ...(rule.queryAliases || []).map(normalize)];
    for (const alias of aliases) {
      if (alias && remaining.includes(` ${alias} `)) {
        if (!plan.tags.includes(tag)) plan.tags.push(tag);
        remaining = remaining.replace(` ${alias} `, ' ');
      }
    }
  }
  const aliases = Object.entries(client.productTypes).flatMap(([type, rule]) => rule.queryAliases.map(alias => [type, normalize(alias)]))
    .sort((a,b) => b[1].length-a[1].length);
  for (const [type, alias] of aliases) {
    if (remaining.includes(` ${alias} `)) { plan.productType = type; remaining = remaining.replace(` ${alias} `, ' '); break; }
  }
  for (const color of Object.keys(client.colors)) {
    if (remaining.includes(` ${color} `)) { plan.colors.push(color); remaining = remaining.replace(` ${color} `, ' '); }
  }
  for (const [finish, rule] of Object.entries(client.finishes || {})) {
    for (const alias of rule.queryAliases) {
      if (remaining.includes(` ${normalize(alias)} `)) {
        if (!plan.finishes.includes(finish)) plan.finishes.push(finish);
        remaining = remaining.replace(` ${normalize(alias)} `, ' ');
      }
    }
  }
  plan.terms = remaining.trim().split(/\s+/).filter(Boolean);
  // Tenant-specific vocabulary rules are produced by the operator agent.
  // They expand a phrase without replacing the shopper's original terms.
  for (const [phrase, terms] of Object.entries(client.semanticAliases || {})) {
    if (normalize(query).includes(normalize(phrase))) {
      for (const term of terms) if (!plan.terms.includes(normalize(term))) plan.terms.push(normalize(term));
    }
  }
  if (plan.productType || plan.colors.length || plan.finishes.length || plan.tags.length || plan.maxPrice !== null) plan.strategy = 'filtered-lexical';
  return plan;
}

// mode "only" narrows the phrase to exactly the linked products (e.g. "יומן" → planners, not novels titled "יומן").
export function matchesScopedAliases(p,plan){
 return (plan.scopedAliases||[]).every(rule=>rule.productIds.includes(p.id)||rule.mode!=='only'&&` ${normalize([p.title,p.name,p.description,p.summary,...(p.categories||[]),...(p.tags||[]),...Object.values(p.specifications||{})].join(' '))} `.includes(` ${normalize(rule.term)} `));
}

export function search(products, client, {query, cursor, limit = 12} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid limit');
  const revision = createHash('sha256').update(JSON.stringify(products)).digest('hex').slice(0,16);
  let offset = 0;
  if (cursor) {
    if (query !== undefined) throw new Error('Cursor cannot be combined with query');
    const state = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (state.tenant !== client.tenantId || state.version !== client.version || state.revision !== revision ||
      !Number.isSafeInteger(state.offset) || state.offset < 0 || typeof state.query !== 'string') throw new Error('Invalid or stale cursor');
    query = state.query; offset = state.offset;
  }
  if (typeof query !== 'string' || !normalize(query)) return {status:'empty', matches:[], nextCursor:null};
  const plan = planQuery(query, client);
  const visible = products.filter(p => p.tenantId === client.tenantId && sellable(p, client));
  const exact = visible.filter(p => normalize(p.id) === normalize(query) || (p.sku && normalize(p.sku) === normalize(query)));
  let matches = exact.length ? exact : visible.filter(p =>
    matchesScopedAliases(p,plan) && (!plan.productType || p.productType === plan.productType) && plan.colors.every(c => p.colors.includes(c)) &&
    plan.finishes.every(f => (p.finishes || []).includes(f)) &&
    plan.tags.every(t => (p.tags || []).includes(t)) &&
    (plan.maxPrice === null || (p.price !== null && p.price <= plan.maxPrice)) &&
    plan.terms.every(t => normalize(p.title).split(' ').includes(t)));
  matches.sort((a,b) => Number(normalize(b.title) === normalize(query))-Number(normalize(a.title) === normalize(query)) || (b.popularity||0)-(a.popularity||0) || a.id.localeCompare(b.id));
  const page = matches.slice(offset,offset+limit);
  return {status:matches.length?'matched':'empty', plan:exact.length?{strategy:'identifier'}:plan,
    total:matches.length, matches:page, nextCursor:offset+limit<matches.length ? Buffer.from(JSON.stringify({tenant:client.tenantId,version:client.version,revision,query,offset:offset+limit})).toString('base64url') : null};
}

export function autocomplete(products, client, query) {
  const prefix = normalize(query);
  if (prefix.length < 2) return [];
  return products.filter(p => p.tenantId === client.tenantId && sellable(p, client) &&
    (normalize(p.title).startsWith(prefix) || normalize(p.title).split(' ').some(t => t.startsWith(prefix))))
    .sort((a,b)=>a.id.localeCompare(b.id)).slice(0,8).map(p=>({type:'product',id:p.id,label:p.title,url:p.url}));
}
