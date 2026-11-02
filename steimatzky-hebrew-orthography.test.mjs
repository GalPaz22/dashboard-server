import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchIndex,createIndexRetriever} from './tenants/steimatzky/engine/core/search-index.mjs';
import {createSearchService} from './tenants/steimatzky/engine/core/semantic.mjs';
import {createDraftRuntime} from './tenants/steimatzky/engine/runtime.mjs';
import {hash} from './tenants/steimatzky/engine/core/hash.mjs';

const profile={tenantId:'t',productTypes:{},colors:{},finishes:{},tagDefinitions:{},queryAliases:{},badgeRules:[],pipeline:{outOfStock:'hide'}};
const book=(id,title,extra={})=>({id,tenantId:'t',title,description:'',categories:[],tags:[],colors:[],finishes:[],stockStatus:'instock',hidden:false,price:80,specifications:{},...extra});
const setup=products=>{
  const retrieve=createIndexRetriever(products,profile,buildSearchIndex(products,'1'));
  const search=createSearchService(products,profile,()=>{throw Error('Title spelling must not need a model');},{retrieve,lightweightRouter:false,expansion:'sparse',expandBelow:5});
  return {retrieve,search};
};
const ids=r=>r.matches.map(p=>p.id);

test('אישה finds אשה despite real-word blurb matches, in full search and autocomplete',async()=>{
  const products=[book('target','אשה בורחת מבשורה'),book('noise','ספר אחר',{description:'אישה בורחת מבשורה'}),book('woman','אישה אחרת')];
  const {retrieve,search}=setup(products);
  for(const query of ['אישה בורחת מבשורה','אישה בורחת','אשה בורחת מבשורה']){
    assert.deepEqual(ids(retrieve(query)),['target'],query);
    const r=await search({query,limit:12});assert.deepEqual(ids(r),['target']);if(query.startsWith('אישה'))assert.equal(r.metadata.llmUsed,false);
  }
  const rt=createDraftRuntime({id:'t',url:'https://example.com',productCards:products,productCardsProfileHash:hash(profile),catalog:{products:[]}},{number:1,profile});
  for(const query of ['אישה בורחת מבשורה','אישה בורחת'])assert.deepEqual(ids(await rt.suggest(query)),['target']);
  assert.deepEqual(ids(retrieve('אישה')),['woman','noise'],'single words keep their exact meaning');
});

test('multiple full/defective words work in both directions and beyond three words',async()=>{
  for(const [title,query] of [
    ['אמא ותכנית הצהרים של דויד','אימא ותוכנית הצהריים של דוד'],
    ['אימא ותוכנית הצהריים של דוד','אמא ותכנית הצהרים של דויד'],
    ['אשה בורחת מבשורה','אִישָּׁה בורחת מבשורה'],
    ['אשה בורחת מבשורה','אישה בורחת מיבשורה'],
  ]){
    const {retrieve,search}=setup([book('target',title),book('other','ספר אחר',{description:query})]);
    assert.deepEqual(ids(retrieve(query)),['target'],query);
    const r=await search({query,limit:12});assert.deepEqual(ids(r),['target']);assert.equal(r.metadata.llmUsed,false,query);
  }
});

test('title spelling outranks generic fuzzy candidates and respects title prefixes',()=>{
  const {retrieve}=setup([book('target','אשה נוסעת באוטובוס'),book('fuzzy','אישה נושאת באוטובוס'),book('blurb','טיול',{description:'אשה נוסעת אוטובוס'})]);
  assert.deepEqual(ids(retrieve('אישה נוסעת אוטובוס')),['target']);
  assert.ok(retrieve('אישה נוסעת אוטובוס').corrections.some(c=>c.kind==='hebrew-spelling'));
});

test('negation words can be literal title words, while added negations stay constraints',async()=>{
  const products=[book('target','אישה בלי רישיון'),book('other','רישיון אחר')],{retrieve}=setup(products);
  assert.deepEqual(ids(retrieve('אשה בלי רשיון')),['target']);
  assert.notEqual(retrieve('אשה ללא רשיון').plan.spelling?.source,'catalog-orthography');
  const rt=createDraftRuntime({id:'t',url:'https://example.com',productCards:products,productCardsProfileHash:hash(profile),catalog:{products:[]}},{number:1,profile});
  assert.deepEqual(ids(await rt.suggest('אשה בלי רשיון')),['target']);
});

test('exact title wins over vowel variants; numbers and non-vowel letters are preserved',()=>{
  const {retrieve}=setup([book('literal','סיפור אהבה'),book('variant','ספר אהבה'),book('model','אמא 1234'),book('consonant','אשה בורחת מבשורה')]);
  assert.equal(retrieve('סיפור אהבה').matches[0].id,'literal');
  for(const query of ['אימא 1235','אישה פורחת מבשורה','וישה בורחת מבשורה']){
    const r=retrieve(query);assert.notEqual(r.plan.spelling?.source,'catalog-orthography',query);
  }
});

test('all filters and visibility apply, and description/author text cannot certify a title',()=>{
  const products=[book('hidden','אשה בורחת מבשורה',{hidden:true}),book('sold','אשה בורחת מבשורה',{stockStatus:'outofstock'}),book('expensive','אשה בורחת מבשורה',{price:500}),book('blurb','ספר אחר',{description:'אשה בורחת מבשורה'}),book('author','ספר אחר / אשה בורחת מבשורה')];
  const r=setup(products).retrieve('אישה בורחת מבשורה עד 100');
  assert.notEqual(r.plan.spelling?.source,'catalog-orthography');
  assert.ok(!r.matches.some(p=>['hidden','sold','expensive'].includes(p.id)));
  assert.notEqual(setup([book('n','אשה בורחת מבשורה')]).retrieve('אישה בורחת ללא בשורה').plan.spelling?.source,'catalog-orthography');
});
