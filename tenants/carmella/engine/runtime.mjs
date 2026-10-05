import {processProduct,autocomplete} from './core/core.mjs';
import {createSearchService} from './core/semantic.mjs';
import {generate} from './core/gemini.mjs';
import {processGarmin} from './tenants/garmin/index.mjs';
import {hash} from './core/hash.mjs';
import {createIndexRetriever,buildSearchIndex,TOKENIZER} from './core/search-index.mjs';
import {createVectorRanker,createPackedRanker} from './core/embeddings.mjs';
import {createHookRunner,hasHooks} from './core/tenant-hooks.mjs';
export function createDraftRuntime(project,revision,{retrieve:overrideRetrieve}={}) {
 const profile={...revision.profile,storeContext:project.storeContext,tenantId:project.id,platform:project.platform,sourceUrl:project.url,version:`studio-${revision.number}`,publishedStatuses:['ACTIVE','publish'],indexPlan:{text:['title','description','specifications'],filter:['productType','colors','finishes','tags','price','stockStatus'],exact:['id','sku','mpn','gtin']}};
 const classifiedTags=new Map();
 for(const [tag,assignment] of Object.entries(project.tagAssignments||{})) {
  if(!Object.hasOwn(profile.tagDefinitions||{},tag)||assignment.definitionHash&&assignment.definitionHash!==hash(profile.tagDefinitions[tag]))continue;
  for(const id of assignment.matchedIds||[]){if(!classifiedTags.has(id))classifiedTags.set(id,[]);classifiedTags.get(id).push(tag)}
 }
 let products=project.productCards?.length&&project.productCardsProfileHash===hash(revision.profile)?project.productCards:project.catalog.products.map(raw=>{
  if(new URL(project.url).hostname.replace(/^www\./,'')==='garmin.co.il')raw=processGarmin(raw);
  raw={...raw,tags:[...new Set([...(raw.tags||[]),...(raw.siteTags||[]),...(classifiedTags.get(String(raw.id))||[])])]};
  const p=processProduct(raw,profile);p.sku=raw.sku||p.sku;if(raw.popularity)p.popularity=raw.popularity;p.mpn=raw.mpn;p.gtin=raw.gtin;p.variants=raw.variants||[];p.priceRange=raw.priceRange;p.badges=Array.isArray(raw.badges)?raw.badges.filter(b=>{if(b.kind==='sale'&&!(Number.isFinite(raw.regularPrice)&&Number.isFinite(raw.price)&&raw.regularPrice>raw.price)){p.issues.push('source-sale-conflict');return false;}if(b.kind==='stock'&&raw.stockStatus!=='outofstock'){p.issues.push('source-stock-conflict');return false;}return true;}).map(b=>({...b})):[];
  if(raw.garmin){p.finishes=raw.garmin.finishes||[];p.garmin=raw.garmin;if(raw.garmin.accessory)p.productType=profile.productTypes.band?.categories.some(c=>p.categories.includes(c))?'band':null;}
  for(const r of profile.badgeRules)if((raw[r.field]||[]).includes(r.value)&&!p.badges.some(b=>b.text===r.text))p.badges.push({text:r.text,kind:'merchant',order:r.order,source:'tenant-rule'});
  p.badges.sort((a,b)=>(a.order||0)-(b.order||0));return p;
 });
 const index=project.searchIndex?.tokenizer===TOKENIZER&&project.searchIndex?.contentHash===hash(products)?project.searchIndex:buildSearchIndex(products,profile.version);
 const retrieve=overrideRetrieve||createIndexRetriever(products,profile,index);
 // A build's vector index (exact content) wins; otherwise the studio's per-product vectors from the processing lab.
 const rankCandidates=project.vectorIndex?.contentHash===hash(products)?createVectorRanker(project.vectorIndex):project.studioVectors?.ids?.length?createPackedRanker(project.studioVectors):null;
 // Tenant functions: rewriteQuery/rerank run per search; transformProduct reshapes the catalog once (in its isolated
 // worker) and the index is rebuilt on the result. If the transform fails, the untransformed catalog keeps serving.
 let hooks=null,hookError=null;if(hasHooks(profile))try{hooks=createHookRunner(profile.hooks,profile.hookData,{tenant:project.id});}catch(e){hookError=e.message;}
 const service=list=>createSearchService(list,profile,generate,{...profile.pipeline,maxEntries:10,retrieve:list===products?retrieve:overrideRetrieve||createIndexRetriever(list,profile,buildSearchIndex(list,profile.version)),rankCandidates,hooks});
 let search=service(products);
 if(hooks?.has('transformProduct')){const base=search;let ready=null;
  const prepare=()=>ready??=hooks.transformProducts(products).then(list=>service(list)).catch(e=>{hookError='transformProduct: '+e.message;return base;});
  search=async request=>(await prepare())(request);search.ready=prepare;}
 return {search,autocomplete:query=>autocomplete(products,profile,query),products,profile,index,functions:hooks?.names||[],get functionError(){return hookError;}};
}
export function indexDefinition(profile={}) {
 const fields={name:[{type:'string'},{type:'autocomplete'}],id:{type:'token'},sku:{type:'token'},mpn:{type:'token'},gtin:{type:'token'},variants:{type:'document',dynamic:false,fields:{id:{type:'token'},sku:{type:'token'},mpn:{type:'token'},gtin:{type:'token'}}},description:{type:'string'},specifications:{type:'document',dynamic:true},tenantId:{type:'token'},categories:{type:'token'},tags:{type:'token'},colors:{type:'token'},finishes:{type:'token'},productType:{type:'token'},price:{type:'number'},stockStatus:{type:'token'},hidden:{type:'boolean'}};
 const selected=[...new Set([...Object.keys(fields),...(profile.indexFields||[])])];
 return {name:'tenant_products_v1',definition:{mappings:{dynamic:false,fields:Object.fromEntries(selected.map(k=>[k,fields[k]]))}}};
}
