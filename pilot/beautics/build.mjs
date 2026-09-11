import { readFile, writeFile, stat } from 'node:fs/promises';
import { processProduct, search } from './core.mjs';
const out = new URL('../../outputs/beautics-pilot/',import.meta.url);
const client = JSON.parse(await readFile(new URL('./client.json',import.meta.url)));
const snapshot = JSON.parse(await readFile(new URL('catalog.json',out)));
if (snapshot.tenantId !== client.tenantId) throw new Error('Tenant mismatch');
const observedAt = (await stat(new URL('source-home.html',out))).mtime.toISOString();
const observations = JSON.parse(await readFile(new URL('source-badges.json',out))).map(o=>({...o,sourceUrl:client.sourceUrl,observedAt}));
let purpleObservedAt = null;
try {
  purpleObservedAt = (await stat(new URL('source-purple.html',out))).mtime.toISOString();
  const extra = JSON.parse(await readFile(new URL('source-purple-badges.json',out)));
  observations.push(...extra.map(o=>({...o,sourceUrl:client.sourceUrl+'product-category/'+encodeURIComponent('סגולים'),observedAt:purpleObservedAt})));
} catch (e) { if (e.code !== 'ENOENT') throw e; }
const products = snapshot.products.map(p=>processProduct(p,client,observations,observedAt));
const queries = ['strong','לק סגול','לק ורוד','לק אדום','לק סגול עד 50','לק סגול מנצנץ','מכונת שיוף','מכונת שיוף עד 800','לק','לק עד 40','מוצרשאינובקטלוג','סגול'];
const runs = queries.map(query=>({query,...search(products,client,{query,limit:5})}));
const counts = field => Object.fromEntries([...products.reduce((map,p)=>{for(const v of p[field]||[]) map.set(v,(map.get(v)||0)+1);return map;},new Map())].sort((a,b)=>b[1]-a[1]));
const report = {
  capturedAt:snapshot.capturedAt,sourceObservedAt:observedAt,purpleObservedAt,mode:'offline-pilot',total:products.length,
  tagged:products.filter(p=>p.tags.length).length,
  withBadgeCandidates:products.filter(p=>p.badgeCandidates.length).length,
  sourceCardsObserved:observations.length,withObservedBadges:products.filter(p=>p.badges.length).length,
  knownProductType:products.filter(p=>p.productType).length,knownPilotColor:products.filter(p=>p.colors.length).length,
  tags:counts('tags'),categories:counts('categories'),issues:counts('issues'),
  caveats:['Source observations apply only to captured homepage/category cards; no global badge rule inferred.',
    'Lexical prototype only; not Atlas or semantic search and not production relevance evaluation.',
    'Existing sync producer is outside the inspected search routes; update/delete behavior not yet verified.',
    'Public preview badges are point-in-time observations, not durable promotion eligibility.'],
};
for (const [name,data] of Object.entries({'products.json':products,'report.json':report,'query-results.json':runs})) {
  await writeFile(new URL(name,out),JSON.stringify(data,null,2));
}
console.log(JSON.stringify({...report,tags:undefined,categories:undefined,caveats:undefined},null,2));
console.log(runs.map(r=>`${r.query}: ${r.total||0}`).join('\n'));
