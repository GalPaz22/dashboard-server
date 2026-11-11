import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent, presentProducts, buildSystemPrompt, conciergeModelConfig} from '../../concierge.mjs';
import {steimatzkyTurnPolicy, steimatzkyCardAllowed} from './concierge-response-policy.mjs';
const store = {dbName:'steimatzky', products:'products'};
const trigger = {query:'אוקיינוס', reason:'alternatives'};
const user = text => ({role:'user',parts:[{text:`<shopper_message>\n${text}\n</shopper_message>`}]});
const doc = (id,name,extra={}) => ({id,name,price:70,stockStatus:'instock',...extra});
function context(rows=[], extra={}) {
  return {store, trigger, shown:new Map(rows.map(p=>[p.id,{product_id:p.id,name:p.name}])),
    deps:{getMongoClient:async()=>({db:()=>({collection:()=>({find:()=>({toArray:async()=>rows})})})})}, ...extra};
}
function client(rounds, calls=[]) {return {models:{async generateContentStream(config) {
  calls.push(config); const parts=rounds.shift() || [{text:'אפשר לפרט מה מחפשים?'}];
  return (async function*(){yield {candidates:[{content:{parts},finishReason:'STOP'}]};})();
}}};}
const call = (name,args) => ({functionCall:{name,args}});
test('restock after explicit refusal needs no model and emits no cards',async()=>{
  const events=[],messages=[user('אני מחפש ספר מסוים ולא תחליף. מתי יהיה זמין?')];
  const result=await runAgent({messages,ctx:context([],{message:'אני מחפש ספר מסוים ולא תחליף. מתי יהיה זמין?'}),onEvent:e=>events.push(e),modelClient:{models:{generateContentStream(){throw Error('must not call');}}}});
  assert.equal(result.stopped,'requested_title_only'); assert.equal(result.usage.rounds,0);
  assert.match(events.find(e=>e.type==='text').text,/אין לי מידע מאומת/);
  assert.equal(events.filter(e=>e.products?.length).length,0);
});
test('refusal persists through Gemini history until explicit acceptance',()=>{
  const history=[user('לא רוצה חלופות'),{role:'model',parts:[{text:'מה תרצה לדעת?'}]}];
  assert.equal(steimatzkyTurnPolicy(store,{history,message:'מתי יחזור?',trigger}).restockQuestion,true);
  assert.equal(steimatzkyTurnPolicy(store,{history,message:'בעצם תציע חלופה',trigger}).alternativesAllowed,true);
  assert.equal(steimatzkyTurnPolicy({dbName:'garmin'},{message:'בלי חלופות'}),null);
});
test('clarification can finish despite prefetched candidates',async()=>{
  const events=[],calls=[];
  const r=await runAgent({messages:[user('תמרה יובל ג׳ונס')],ctx:context([doc('1','נקסוס')]),onEvent:e=>events.push(e),modelClient:client([[{text:'מה שם הספר או המחבר המלא?'}]],calls)});
  assert.equal(r.stopped,'STOP');assert.equal(calls.length,1);assert.equal(events.filter(e=>e.products?.length).length,0);
});
test('presentation cannot fetch guessed IDs that were not read this turn',async()=>{
  const ctx=context([doc('1','אוקיינוס')]);ctx.shown.clear();
  assert.deepEqual((await presentProducts({product_ids:['1']},ctx)).products,[]);
});
test('presentation rejects a different destination, wrong kind, hidden and sold-out cards',async()=>{
  const rows=[doc('berlin','ברלין מדריך מטרופוליס'),doc('tz','טנזניה מדריך למטייל'),doc('hidden','טנזניה',{hidden:true}),doc('sold','טנזניה',{stockStatus:'outofstock'})];
  const ctx=context(rows,{responsePolicy:steimatzkyTurnPolicy(store,{message:'מדריך טיולים טנזניה'})});
  assert.deepEqual((await presentProducts({product_ids:rows.map(r=>r.id)},ctx)).products,[]);
  assert.deepEqual((await presentProducts({product_ids:['tz']},ctx)).products.map(p=>p.product_id),['tz']);
  const game=steimatzkyTurnPolicy(store,{message:'ילדי בית העץ משחק'});
  assert.equal(steimatzkyCardAllowed({name:'ילדי בית העץ',in_stock:true,categories:['ספרים']},game),false);
  assert.equal(steimatzkyCardAllowed({name:'ילדי בית העץ',in_stock:true,categories:['משחקים']},game),true);
  assert.equal(steimatzkyTurnPolicy(store,{message:'משחקי הרעב'}).game,false);
});
test('refusal blocks alternative tools before any database call',async()=>{
  const events=[];const ctx=context([],{message:'בלי חלופות'});ctx.deps.getMongoClient=async()=>{throw Error('must not search alternatives');};
  await runAgent({messages:[user(ctx.message)],ctx,onEvent:e=>events.push(e),modelClient:client([[call('find_alternatives',{name:'אוקיינוס'})],[{text:'אבדוק רק את הספר שביקשת.'}]])});
  assert.ok(events.some(e=>e.type==='tool_end'&&e.tool==='find_alternatives'));
  assert.equal(events.filter(e=>e.type==='error'||e.products?.length).length,0);
});
test('rejected selections never reach streamed cards and clarification remains possible',async()=>{
  const events=[];const ctx=context([doc('berlin','ברלין מדריך מטרופוליס')],{message:'מדריך טיולים טנזניה'});
  await runAgent({messages:[user(ctx.message)],ctx,onEvent:e=>events.push(e),modelClient:client([[{text:'מדריך ברלין מתאים בדיוק'},call('present_products',{product_ids:['berlin']})],[{text:'אין לי מדריך מאומת לטנזניה. איזה מידע על הטיול נחוץ לך?'}]])});
  assert.equal(events.filter(e=>e.products?.length).length,0);assert.equal(events.at(-1).type,'done');
  assert.ok(events.some(e=>e.type==='text_reset'));
  const finalText=events.reduce((s,e)=>e.type==='text_reset'?'':e.type==='text'?s+e.text:s,'');
  assert.doesNotMatch(finalText,/ברלין/);
});
test('Steimatzky never auto-selects unchosen candidates after exhausting research rounds',async()=>{
  const events=[],calls=[],ctx=context([doc('1','אוקיינוס')]);
  await runAgent({messages:[user('שאלה')],ctx,onEvent:e=>events.push(e),modelClient:client(Array.from({length:8},()=>[call('unknown_tool',{})]),calls)});
  assert.equal(calls.length,8);assert.ok(calls.every(c=>c.config.toolConfig.functionCallingConfig.mode==='AUTO'));
  assert.equal(events.filter(e=>e.products?.length).length,0);
});
test('other merchants keep product-card enforcement and original model configuration',async()=>{
  const events=[],calls=[],ctx=context([doc('1','שעון')]);ctx.store={dbName:'garmin',products:'products'};
  await runAgent({messages:[user('שעון')],ctx,onEvent:e=>events.push(e),modelClient:client([[{text:'שעון'}],[call('present_products',{product_ids:['1']})],[{text:'הנה השעון'}]],calls)});
  assert.ok(calls.length>1);assert.ok(events.some(e=>e.products?.length));
  assert.deepEqual(conciergeModelConfig(store),{model:'gemini-3.5-flash-lite',thinkingLevel:'LOW'});
  assert.doesNotMatch(buildSystemPrompt(ctx.store),/כללי תשובה מחייבים — סטימצקי/);
  assert.match(buildSystemPrompt(store),/כללי תשובה מחייבים — סטימצקי/);
});
