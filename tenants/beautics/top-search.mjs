import {normalize} from '../../pilot/beautics/core.mjs';

const words = value => normalize(value).match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';
const has = (text, phrase) => ` ${text} `.includes(` ${words(phrase)} `);
const remove = (text, phrase) => (` ${text} `).split(` ${words(phrase)} `).join(' ').trim();

// Brand names and the mixed base/top/linker categories do not prove a top coat.
// Keep these merchant vocabulary rules separate from the shared search engine.
export function createTopSearch(products, client) {
  const rules = client.topSearch;
  if (!rules) return () => null;
  const aliases = [...rules.queryAliases].sort((a,b)=>b.length-a.length);
  const withoutBrands = text => rules.brandPhrases.reduce(remove,text);
  const catalog = products.filter(p=>p.tenantId===client.tenantId&&!p.hidden&&p.stockStatus==='instock').map(p=>{
    const title = words(p.title), productTitle = withoutBrands(title);
    const top = rules.titleTerms.some(term=>has(productTitle,term)) ||
      (rules.categories.some(c=>p.categories.includes(c)) && !rules.conflictingTitleTerms.some(term=>has(title,term)) && productTitle===title);
    const spreading = rules.spreading.titlePhrases.some(term=>has(title,term));
    return {p,title,top,spreading};
  });
  return query => {
    const original = words(query);
    // A request for Top Nail / Top Spa is a brand request, not a top-coat filter.
    const alias = aliases.find(term=>has(withoutBrands(original),term));
    if (!alias) return null;
    let remaining = normalize(query);
    const budget = remaining.match(/(?:^|\s)עד\s+(\d+(?:\.\d+)?)\s*(?:שקל(?:ים)?|שח|₪)?/);
    const maxPrice = budget ? Number(budget[1]) : null;
    if (budget) remaining = remaining.replace(budget[0],' ');
    remaining = remove(words(remaining),alias);
    const spreading = rules.spreading.queryAliases.some(term=>has(remaining,term));
    if (spreading) for (const term of rules.spreading.queryAliases) remaining = remove(remaining,term);
    const terms = remaining.split(' ').filter(Boolean);
    const matches = catalog.filter(({p,title,top,spreading:isSpreading})=>
      (spreading ? isSpreading : top) && terms.every(term=>has(title,term)) &&
      (maxPrice===null || (p.price!==null && p.price<=maxPrice)))
      .map(({p})=>p).sort((a,b)=>a.id.localeCompare(b.id));
    return {status:matches.length?'matched':'empty',matches,
      message:matches.length ? null : 'לא נמצאו מוצרים התואמים לכל מאפייני החיפוש.',
      metadata:{mode:'tenant-catalog',phase:'catalog-rules',catalogRule:spreading?'spreading-top':'top-coat',
        authoritative:true,fullMatch:true,llmUsed:false,llmCalls:0}};
  };
}
