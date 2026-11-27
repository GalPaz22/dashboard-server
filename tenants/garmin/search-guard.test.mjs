import test from 'node:test';
import assert from 'node:assert/strict';
import {guardGarminSearch,parseBandQuery,bandsFor,bandSpec,isPartNumber} from './search-guard.mjs';
import {createSearchService} from '../garmin-semantix/engine/core/semantic.mjs';

const product=(id,title,categories=[],extra={})=>({id,tenantId:'t',title,description:'',specifications:{},categories,tags:[],colors:[],finishes:[],sku:'',price:100,stockStatus:'instock',hidden:false,...extra});
const BANDS=['רצועות לשעון גרמין'];
const products=[
 product('w41','שעון ספורט Venu® 4 (41mm) - Black',['GARMIN Venu'],{sku:'010-03013-02H'}),
 product('qr18','רצועה Quick Release Bands (18 mm)',BANDS),
 product('qr20','רצועה Quick Release Bands (20 mm)',BANDS),
 product('qr22','רצועה Quick Release Bands (22 mm)',BANDS,{stockStatus:'outofstock'}),
 product('qf22','רצועה QuickFit® 22 Watch Bands',BANDS),
 product('qf26','QuickFit® 26 Watch Bands Moss Silicone',BANDS),
 product('ti26','QuickFit® 26 Watch Bands Vented Titanium Bracelet',BANDS),
 product('hrm','רצועת דופק HRM-600™ M-XL',['רצועות דופק גרמין']),
 product('axle','ציר גלגל אחורי לטריינר Tacx E-Thru 12mm',['Tacx - אביזרים']),
];
const profile={pipeline:{outOfStock:'show'},publishedStatuses:['publish']};
const never=async()=>{throw Error('the engine must not run');};
const ask=(query,engine=never)=>guardGarminSearch({query,products,profile,engine});
const ids=r=>r.matches.map(p=>p.id);

test('a band search for a watch returns the bands that fit it, never the watch', async () => {
  const r=await ask('רצועות לשעון Venus 4');
  assert.deepEqual(ids(r),['qr18','qr22']);          // in stock first
  assert.equal(r.metadata.llmCalls,0);
  assert.deepEqual(ids(await ask('רצועה venu 4 41')),['qr18']);
  assert.deepEqual(ids(await ask('Vivoactive 6 רצועה')),['qr20']);
  assert.deepEqual(ids(await ask('רצועה לשעון פניקס 6')),['qf22']);
  assert.deepEqual(ids(await ask('רצועת טיטניום לפלקס 8 פרו')),['ti26']);
  assert.deepEqual(ids(await ask('רצועות 5x')).sort(),['qf26','ti26']);
});

test('a width or system the store does not stock gives no results instead of another band', async () => {
  for(const q of ['"QuickFit® 20"','ultrafit 20','רצועה lily']){const r=await ask(q);assert.deepEqual(r.matches,[],q);assert.equal(r.status,'empty');assert.ok(r.message,q);}
});

test('an unknown model goes to the engine and keeps only bands it verified', async () => {
  const engine=(closestFallback)=>async()=>({status:'matched',matches:[products[0],products[2]],metadata:{closestFallback}});
  assert.deepEqual(ids(await ask('רצועה לאינסטינקט 3',engine(false))),['qr20']);
  assert.deepEqual(ids(await ask('רצועה לאינסטינקט 3',engine(true))),[]);
});

test('watches that come with a strap, heart-rate straps and mounts are not band searches', () => {
  for(const q of ['שעון עם רצועת עור','רצועת דופק','garmin cirqa רצועה','רצועת ניטור שינה','QuickFit Quarter-turn Bike Mount','venu 4','Instinct 3 Solar | 50mm Black with Charcoal Band'])
    assert.equal(parseBandQuery(q),null,q);
  assert.deepEqual(bandsFor({family:'venu',model:'4',size:45}),[['quickrelease',22]]);
  assert.equal(bandsFor({family:'instinct',model:'3',size:null}),null);
  assert.deepEqual(bandSpec('UltraFit Nylon Straps (26 mm) Black'),{system:'quickfit',width:26,ultrafit:true});
});

test('a heart-rate strap search shows heart-rate straps', async () => {
  const r=await ask('רצועת דופק',async()=>({status:'matched',matches:[products[0],products[7]],metadata:{}}));
  assert.deepEqual(ids(r),['hrm']);
});

test('part numbers and service questions are answered without a model', async () => {
  assert.deepEqual(ids(await ask('010-03013-02')),['w41']);
  assert.deepEqual(ids(await ask('0101301302')),[]);
  assert.equal(isPartNumber('0100301302'),true);
  for(const q of ['010-13308-00','904-40','XS‑F40CWB','טרייד אין','BUYME']){const r=await ask(q);assert.deepEqual(r.matches,[],q);assert.ok(r.message,q);}
  const ran=await ask('Venu 4',async()=>({status:'matched',matches:[products[0]],metadata:{}}));
  assert.deepEqual(ids(ran),['w41']);
});

const shop=[product('axle','ציר גלגל אחורי לטריינר Tacx',['Tacx'],{description:'ציר'}),product('towel','מגבת Tacx',['Tacx'])];
const client={tenantId:'t',platform:'woocommerce',sourceUrl:'https://x',productTypes:{},colors:{},finishes:{},tagDefinitions:{},queryAliases:{},publishedStatuses:['publish']};
const plan={intent:'x',categories:['Tacx'],terms:['tacx'],requirements:['x'],maxPrice:null,minPrice:null,colors:[],finishes:[],tags:[],clarification:''};
const service=(select)=>{const stages=[];const run=createSearchService(shop,client,async({stage})=>{stages.push(stage);
  if(stage==='route')return {data:{route:'semantic',rewrites:[],message:''}};
  return {data:stage==='interpret'?plan:select};},{strictAlternatives:true});return {run,stages};};

test('strict alternatives: nothing related means no results and no second model call', async () => {
  const {run,stages}=service({matches:[],alternatives:[]});
  const r=await run({query:'שואב אבק'});
  assert.equal(r.status,'empty');assert.deepEqual(r.matches,[]);assert.equal(r.metadata.phase,'no-related-results');
  assert.equal(stages.filter(s=>s==='select').length,1);
});

test('strict alternatives: only items of the kind asked for are shown, from the first call', async () => {
  const item=(id,sameKind)=>({id,reason:'x',missing:[],sameKind});
  const {run,stages}=service({matches:[],alternatives:[item('axle',false),item('towel',true)]});
  const r=await run({query:'מגבת ספורט'});
  assert.deepEqual(ids(r),['towel']);assert.equal(stages.filter(s=>s==='select').length,1);
});

test('a product whose title carries the words, or a series name with hyphens, is searched as usual', async () => {
  const stand={...product('stand','מעמד לתיקון אופניים Tacx CycleMotion',['Tacx'])};
  const engine=async()=>({status:'matched',matches:[stand],metadata:{}});
  assert.deepEqual(ids(await guardGarminSearch({query:'מעמד תיקון',products:[...products,stand],profile,engine})),['stand']);
  assert.deepEqual(ids(await ask('venu-4-45',engine)),['stand']);
});
