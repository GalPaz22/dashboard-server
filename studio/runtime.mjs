import {processProduct,autocomplete} from '../pilot/beautics/core.mjs';
import {createSearchService} from '../pilot/beautics/semantic.mjs';
import {generate} from '../pilot/beautics/gemini.mjs';
export function createDraftRuntime(project,revision) {
 const profile={...revision.profile,tenantId:project.id,platform:project.platform,sourceUrl:project.url,version:`studio-${revision.number}`,publishedStatuses:['ACTIVE','publish'],indexPlan:{text:['title'],filter:['productType','colors','finishes','price','stockStatus'],exact:['id','sku']}};
 const products=project.catalog.products.map(raw=>{
  const p=processProduct(raw,profile);p.badges=Array.isArray(raw.badges)?raw.badges:[];
  for(const r of profile.badgeRules)if((raw[r.field]||[]).includes(r.value)&&!p.badges.some(b=>b.text===r.text))p.badges.push({text:r.text,kind:'merchant',order:r.order,source:'tenant-rule'});
  p.badges.sort((a,b)=>(a.order||0)-(b.order||0));return p;
 });
 return {search:createSearchService(products,profile,generate,{...profile.pipeline,maxEntries:10}),autocomplete:query=>autocomplete(products,profile,query),products,profile};
}
export function indexDefinition(profile={}) {
 const fields={name:[{type:'string'},{type:'autocomplete'}],id:{type:'token'},categories:{type:'token'},tags:{type:'token'},colors:{type:'token'},finishes:{type:'token'},productType:{type:'token'},price:{type:'number'},stockStatus:{type:'token'},hidden:{type:'boolean'}};
 const selected=[...new Set(['name','id',...(profile.indexFields||Object.keys(fields))])];
 return {name:'tenant_products_v1',definition:{mappings:{dynamic:false,fields:Object.fromEntries(selected.map(k=>[k,fields[k]]))}}};
}
