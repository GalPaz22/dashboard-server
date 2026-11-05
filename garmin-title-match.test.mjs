import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchService} from './tenants/garmin-semantix/engine/core/semantic.mjs';

// Garmin shoppers often search a product's whole title (an autocomplete pick, a name pasted from the site). Those answered
// after two or three model calls (3.6 s, up to 10 s); 250 of 399 model searches on 2-5.11.2026 were such titles.
const profile={tenantId:'garmin',productTypes:{},colors:{},finishes:{},tagDefinitions:{},queryAliases:{},badgeRules:[],pipeline:{}};
const watch=(id,title,extra={})=>({id,tenantId:'garmin',title,description:'',categories:[],tags:[],colors:[],finishes:[],stockStatus:'instock',hidden:false,price:1500,specifications:{},...extra});
const noModel=()=>{throw Error('This search must not need a model');};
const ids=r=>r.matches.map(p=>p.id);

test('a whole product title answers at once from the catalog, without the model',async()=>{
 const products=[watch('fr255','Forerunner® 255 | 46mm'),watch('fr255s','Forerunner® 255S | 41mm'),watch('inst','Instinct® 3 Amoled | 50mm Black with Charcoal Band')];
 const search=createSearchService(products,profile,noModel,{lightweightRouter:false,expansion:'off'});
 const a=await search({query:'Forerunner® 255 | 46mm',limit:12});
 assert.equal(ids(a)[0],'fr255');assert.equal(a.metadata.phase,'title-match');assert.equal(a.metadata.llmUsed,false);
 const b=await search({query:'instinct 3 amoled | 50mm black with charcoal band',limit:12});
 assert.deepEqual(ids(b).slice(0,1),['inst'],'case and ® do not matter');assert.equal(b.metadata.llmCalls,0);
});

test('a hidden product\'s title does not answer, and a query that is not a whole title still reaches the model',async()=>{
 const products=[watch('old','Venu® 4 (45mm) - Slate + Black',{hidden:true}),watch('fr','Forerunner® 965 | 47mm')];
 let called=0;const generate=async()=>{called++;throw Error('model down');};
 const search=createSearchService(products,profile,generate,{lightweightRouter:false,expansion:'off'});
 const a=await search({query:'Venu® 4 (45mm) - Slate + Black',limit:12});
 assert.notEqual(a.metadata.phase,'title-match');
 const b=await search({query:'שעון ריצה עם מפות ומוזיקה',limit:12});
 assert.notEqual(b.metadata.phase,'title-match');assert.ok(called>=1);
});
