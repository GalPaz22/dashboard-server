import test from 'node:test';
import assert from 'node:assert/strict';
import {looksLikeGarminSku} from './concierge.mjs';
import {decideTrigger} from '../../concierge.mjs';

test('part numbers are recognised; model names and plain numbers are not',()=>{
  for(const q of ['010-04337-41H','010-03199-40H','010-02980-03',' 010-04337-41h ','020-00336-00H'])assert.equal(looksLikeGarminSku(q),true,q);
  for(const q of ['Forerunner 970','RS210','HRM-600','Fenix-8','255','Garmin Forerunner 970','010 04337 41H','שעון'])assert.equal(looksLikeGarminSku(q),false,q);
});

test('a Garmin part number never opens the concierge, even with nothing found; other stores are unaffected',async()=>{
  assert.equal(await decideTrigger({payload:[],query:'010-04337-41H',store:{dbName:'garmin'},ctx:{}}),null);
  assert.equal((await decideTrigger({payload:[],query:'010-04337-41H',store:{dbName:'other'},ctx:{}}))?.reason,'no_results');
  assert.equal((await decideTrigger({payload:[],query:'Forerunner 970',store:{dbName:'garmin'},ctx:{}}))?.reason,'no_results');
});

test('the concierge only offers products a shopper can open and buy',async()=>{
  const {offeredToShoppers}=await import('../../concierge.mjs');
  const base={id:'1',name:'Instinct 3',price:1699,status:'publish',catalog_visibility:'visible',stockStatus:'instock'};
  assert.equal(offeredToShoppers(base),true);
  assert.equal(offeredToShoppers({id:'2',name:'no Woo fields',price:99}),true);
  assert.equal(offeredToShoppers({id:'3',name:'no price field'}),true);
  for(const p of [{...base,status:'private'},{...base,status:'DRAFT'},{...base,catalog_visibility:'hidden'},{...base,price:0},{...base,price:'0'},{...base,hidden:true},null])
    assert.equal(offeredToShoppers(p),false,JSON.stringify(p));
});

test('Garmin instructions carry the square watch, same-kind alternatives and service questions; other stores get none',async()=>{
  const {garminConciergeInstructions}=await import('./concierge.mjs');
  const text=garminConciergeInstructions({dbName:'garmin'});
  for(const must of ['Venu X1','שעון במקום שעון','BuyMe','Titanium'])assert.ok(text.includes(must),must);
  assert.equal(garminConciergeInstructions({dbName:'steimatzky'}),'');
});

test('the Garmin prompt says what to search before claiming the store lacks something', async () => {
  const {buildSystemPrompt} = await import('../../concierge.mjs');
  const prompt = buildSystemPrompt({dbName: 'garmin'});
  for (const rule of ['Cadence Sensor', 'לא מצאתי אותו כרגע באתר', 'QuickFit 26', 'גלישת רוח']) assert.match(prompt, new RegExp(rule));
});

test('a service search is told apart from a product search', async () => {
  const {looksLikeGarminServiceQuery, garminServiceOpening} = await import('./concierge.mjs');
  for (const q of ['טרייד אין', 'Trade in', 'trade-in', 'החלפת סוללה', 'עדכון שעון', 'Nuro brave', 'אחריות', 'שובר BuyMe']) assert.equal(looksLikeGarminServiceQuery(q), true, q);
  for (const q of ['שעון בהנחה', 'fenix 8', 'רצועת דופק', 'מטען לשעון', 'שעון לריצה', '']) assert.equal(looksLikeGarminServiceQuery(q), false, q);
  assert.match(garminServiceOpening('טרייד אין'), /אל תאמר שהשירות אינו קיים/);
});

test('fenix and vivoactive are literal hits on fēnix and vívoactive: the chat stays closed', async () => {
  const hit = (name) => [{id: '1', name, stockStatus: 'instock'}];
  assert.equal(await decideTrigger({payload: hit('שעון ספורט fēnix® 8 – 47mm AMOLED'), query: 'Fenix 8 47mm', store: {dbName: 'garmin'}, ctx: {}}), null);
  assert.equal(await decideTrigger({payload: hit('שעון ספורט - vívoactive® 6 שחור'), query: 'Garmin Vivoactive 6', store: {dbName: 'garmin'}, ctx: {}}), null);
});

test('manuals and service tracking are service searches', async () => {
  const {looksLikeGarminServiceQuery} = await import('./concierge.mjs');
  for (const q of ['חוברת הדרכה בעברית לשעון גרמן פרו פניקס 9', 'הוראות הפעלה לשעוני GARMIN', 'מדריך למשתמש', 'מעקב שירות']) assert.equal(looksLikeGarminServiceQuery(q), true, q);
  for (const q of ['מעקב שינה', 'שעון עם מדריך אימונים', 'T2885']) assert.equal(looksLikeGarminServiceQuery(q), false, q);
});

test('a part number without hyphens is matched against the sku; model names are not', async () => {
  const {partNumberPattern} = await import('../../concierge.mjs');
  assert.equal(partNumberPattern('T2885').test('T2885'), true);
  assert.equal(partNumberPattern('t2885').test('010-13308-00H'), false);
  assert.equal(partNumberPattern('180001H').test('010-01800-01H'), true);
  assert.equal(partNumberPattern('0100264514H').test('010-02645-14H'), true);
  assert.equal(partNumberPattern('02645-14H').test('010-02645-14H'), true); // the ending alone
  for (const q of ['fenix6', '40mm', '245', 'Forerunner 970', 'HRM-600', 'שעון 12345', '']) assert.equal(partNumberPattern(q), null, q);
});

test('a model that goes silent is cut: cards already shown close the turn, otherwise one retry', async () => {
  process.env.CONCIERGE_MODEL_STALL_MS = '40';
  const {runAgent} = await import('../../concierge.mjs?stall');
  const silent = (config) => (async function* () { await new Promise((_, reject) => config.abortSignal.addEventListener('abort', () => reject(new Error('This operation was aborted')))); })();
  const answer = () => (async function* () { yield {candidates: [{finishReason: 'STOP', content: {parts: [{text: 'אין לי את המידע הזה.'}]}}]}; })();
  let calls = 0;
  const client = {models: {generateContentStream: async ({config}) => (++calls === 1 ? silent(config) : answer())}};
  const events = [];
  const result = await runAgent({messages: [{role: 'user', parts: [{text: 'אחריות'}]}], ctx: {store: {dbName: 'garmin'}, deps: {}}, onEvent: e => events.push(e), modelClient: client});
  assert.equal(calls, 2);
  assert.equal(result.stopped, 'STOP');
  assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), 'אין לי את המידע הזה.');
});
