import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchIndex,createIndexRetriever} from './tenants/steimatzky/engine/core/search-index.mjs';
import {createSearchService} from './tenants/steimatzky/engine/core/semantic.mjs';
import {createAuthorResolver,transliterates} from './tenants/steimatzky/engine/core/names.mjs';
import {withSource} from './tenants/steimatzky/search.mjs';

// The fix notes of the conversion report of 08.11.2026: an English title finds its Hebrew edition, a named product line
// keeps its brand, and a card offers only the formats on sale.
const profile={tenantId:'t',productTypes:{},colors:{},finishes:{},tagDefinitions:{},queryAliases:{},badgeRules:[],pipeline:{outOfStock:'hide'}};
const book=(id,title,extra={})=>({id,tenantId:'t',title,description:'',categories:[],tags:[],colors:[],finishes:[],stockStatus:'instock',hidden:false,price:80,specifications:{},...extra});
const plan=extra=>({intent:'',categories:[],terms:[],requirements:[],maxPrice:null,minPrice:null,colors:[],finishes:[],tags:[],clarification:'',...extra});
const setup=(products,generate)=>createSearchService(products,profile,generate,{retrieve:createIndexRetriever(products,profile,buildSearchIndex(products,'1')),lightweightRouter:false,expansion:'sparse',expandBelow:5});
const ids=r=>r.matches.map(p=>p.id);
const scripted=answers=>{const calls=[];const generate=async({stage,prompt})=>{calls.push({stage,prompt});const next=answers[stage]?.shift();if(next instanceof Error)throw next;if(next===undefined)throw Error('unexpected '+stage);return {data:next};};generate.calls=calls;return generate;};
const money=()=>[book('he','הפסיכולוגיה של הכסף',{specifications:{author:'מורגן האוסל'},categories:['כלכלה']}),book('why','ציר ה - WHY',{categories:['כלכלה']}),
 book('fore','תחזיות על',{categories:['כלכלה']}),book('code','קוד סמוי',{categories:['כלכלה']})];

test('an English title answers with its Hebrew edition first, by the author the model named, even when the selector ranks it lower',async()=>{
 const generate=scripted({interpret:[plan({intent:'ספר',categories:['כלכלה'],terms:['psychology of money','הפסיכולוגיה של הכסף','Morgan Housel'],requirements:['psychology of money']})],
  select:[{matches:[{id:'why',evidence:[{requirement:0,field:'title',quote:'WHY'}]}],alternatives:[]}]});
 const r=await setup(money(),generate)({query:'psychology of money',limit:12});
 // 09.11: "WHY" carries no word of the title or of its author, so the name check drops it: it is another book.
 assert.deepEqual(ids(r),['he']);assert.equal(r.matches[0].matchQuality,'edition');assert.deepEqual(r.metadata.editionIds,['he']);
 assert.match(generate.calls[1].prompt,/"id":"he"/,'the edition is among what the selector reads');
});

test('a local title without the named author needs the selector\'s check',async()=>{
 const generate=scripted({interpret:[plan({intent:'ספר',terms:['הפסיכולוגיה של הכסף'],requirements:['psychology of money']})],select:[{matches:[],alternatives:[]},{matches:[],departments:['כלכלה']}]});
 const r=await setup(money(),generate)({query:'the psychology of money',limit:12});
 assert.notEqual(r.matches[0]?.matchQuality,'edition');assert.equal(r.metadata.editionIds,undefined);
});

test('the work found by its author when the model knows no local title, and the next shopper gets it without the model',async()=>{
 const products=[book('jsmith','למה אף אחד לא אמר לי את זה קודם?',{specifications:{author:'ד”ר ג’ולי סמית’'},categories:['פסיכולוגיה']}),
  book('will','ספר אחר',{specifications:{author:'ויל סמית'}}),book('before','EICHMANN BEFORE JERUSALEM',{categories:['history']})];
 const generate=scripted({interpret:[plan({intent:'ספר',terms:['Why Has Nobody Told Me This Before','Dr Julie Smith'],requirements:['Why Has Nobody Told Me This Before']})],
  select:[{matches:[{id:'jsmith',evidence:[{requirement:0,field:'specifications',quote:'ד”ר ג’ולי סמית’'}]}],alternatives:[]}]});
 const r=await setup(products,generate)({query:'why has nobody told me this before',limit:12});
 assert.equal(ids(r)[0],'jsmith');assert.equal(r.matches[0].matchQuality,'edition');
 const prompt=generate.calls[1].prompt;assert.match(prompt,/"id":"jsmith"/);assert.doesNotMatch(prompt,/"id":"will"/,'Will Smith is not Julie Smith');
 // A new runtime (a rebuild) remembers the edition by title and author.
 const again=await setup(products,()=>{throw Error('no model')})({query:'Why has nobody told me this before',limit:12});
 assert.equal(ids(again)[0],'jsmith');assert.equal(again.metadata.phase,'edition');assert.equal(again.metadata.llmUsed,false);
});

test('"english" in the query keeps the original edition first; the Hebrew one follows',async()=>{
 const products=[...money(),book('en','HOW MONEY WORKS',{categories:['כלכלה']})];
 const generate=scripted({interpret:[plan({intent:'ספר',categories:['כלכלה'],terms:['הפסיכולוגיה של הכסף','Morgan Housel'],requirements:['psychology of money in english']})],
  select:[{matches:[{id:'en',evidence:[{requirement:0,field:'title',quote:'MONEY'}]}],alternatives:[]}]});
 const r=await setup(products,generate)({query:'psychology of money english',limit:12});
 assert.deepEqual(ids(r).slice(0,2),['en','he']);
});

test('author names: a title before the name is no word of it, and a leading vowel letter is not dropped before a consonant',()=>{
 const resolve=createAuthorResolver([book('a','x',{specifications:{author:'ד”ר ג’ולי סמית’'}}),book('b','y',{specifications:{author:'ויל סמית'}})],profile);
 assert.deepEqual(resolve('Dr Julie Smith').ids,['a']);assert.deepEqual(resolve('julie smith').ids,['a']);assert.deepEqual(resolve('will smith').ids,['b']);
 assert.equal(transliterates('julie','ויל'),false);assert.equal(transliterates('will','ויל'),true);assert.equal(transliterates('yanagihara','ינגיהארה'),true);
});

test('"english" with no English edition in the store: the Hebrew edition still comes before unrelated alternatives',async()=>{
 const generate=scripted({interpret:[plan({intent:'ספר',categories:['כלכלה'],terms:['Psychology of Money','הפסיכולוגיה של הכסף','Morgan Housel'],requirements:['ספר באנגלית','psychology of money']})],
  select:[{matches:[],alternatives:[{id:'why'},{id:'fore'}]}]});
 const r=await setup(money(),generate)({query:'psychology of money in english',limit:12});
 assert.equal(ids(r)[0],'he');
 // The model writes the local title without its article and rejects every candidate: the author's book is still the work.
 const g2=scripted({interpret:[plan({intent:'ספר',terms:['Psychology of Money','פסיכולוגיה של הכסף','Morgan Housel'],requirements:['psychology of money']})],select:[{matches:[],alternatives:[]},{matches:[],departments:['כלכלה']}]});
 const r2=await setup(money(),g2)({query:'the psychology of money book',limit:12});
 assert.equal(ids(r2)[0],'he');assert.equal(r2.matches[0].matchQuality,'edition');
});

const toys=()=>[book('p1','פליימוביל גולש סקי',{categories:['צעצועים'],popularity:7}),book('p2','פליימוביל חוות תרנגולות קטנה',{popularity:3}),book('p3','פליימוביל תצפית דינוזאור',{popularity:5}),
 book('puzzle','פאזל רצפה ענק תיבת נח 48 חל’',{categories:['צעצועים']}),book('novel','החיפוש אחר תיבת נח',{categories:['מתח']}),book('fort','מונופול פורטנייט',{categories:['משחקים']})];

test('a named product line keeps its brand: no Noah\'s Ark puzzle as a Playmobil match, the line\'s own sets instead, no second call',async()=>{
 const generate=scripted({interpret:[plan({intent:'צעצוע',terms:['פלמוביל','Playmobil','תיבת נח'],requirements:['פלמוביל תיבת נח']})],
  select:[{matches:[{id:'puzzle',evidence:[{requirement:0,field:'title',quote:'תיבת נח'}]}],alternatives:[]}]});
 const r=await setup(toys(),generate)({query:'פלמוביל תיבת נח',limit:12});
 assert.deepEqual(ids(r),['p1','p3','p2','puzzle'],'the line by popularity, then one toy of its department; no novel, no Monopoly');
 assert.ok(r.matches.every(p=>p.matchQuality==='alternative'));assert.equal(r.metadata.closestFallback,true);assert.equal(r.metadata.alternativesFrom,'line');assert.equal(r.metadata.phase,'closest-alternatives');
 assert.deepEqual(generate.calls.map(c=>c.stage),['interpret','select']);
});

test('a product of the line the selector verified stays a match; a Hebrew noun that starts titles is no line',async()=>{
 const products=[...toys(),book('ark','פליימוביל תיבת נח עם חיות')];
 const generate=scripted({interpret:[plan({intent:'צעצוע',terms:['פליימוביל','Playmobil','תיבת נח'],requirements:['פליימוביל תיבת נח']})],
  select:[{matches:[{id:'ark',evidence:[{requirement:0,field:'title',quote:'פליימוביל תיבת נח'}]},{id:'puzzle',evidence:[{requirement:0,field:'title',quote:'תיבת נח'}]}],alternatives:[]}]});
 const r=await setup(products,generate)({query:'פליימוביל נח',limit:12});
 assert.equal(ids(r)[0],'ark');assert.ok(!ids(r).includes('puzzle'));
 const books=[book('s1','ספר הבישול הגדול'),book('s2','ספר הדינוזאורים'),book('s3','ספר השירים'),book('ck','מתכונים של סבתא',{categories:['בישול']})];
 const g2=scripted({interpret:[plan({intent:'ספר',terms:['ספר','מתכונים'],requirements:['ספר מתכונים של סבתא']})],select:[{matches:[{id:'ck',evidence:[{requirement:0,field:'title',quote:'מתכונים של סבתא'}]}],alternatives:[]}]});
 assert.equal(ids(await setup(books,g2)({query:'ספר מתכונים סבתא',limit:12}))[0],'ck');
});

test('a card offers only the formats on sale: the printed edition of a digital card is checked against its own row',()=>{
 const label=(digitalSku,badge='ספר50')=>({type:'book_formats',printed:{enabled:true,value:50,badge:'ספר50'},digital:{enabled:true,value:24,sku:digitalSku,badge:'₪ 24'},badge:{enabled:true,value:badge}});
 const rows=[{id:'online:iw:IL:011051542',stockStatus:'outofstock',specialLabel:label('600000062')},{id:'online:iw:IL:600000062',stockStatus:'instock',specialLabel:label('600000062','₪ 24')},
  {id:'online:iw:IL:012193009',stockStatus:'instock',specialLabel:label('600200384')},{id:'online:iw:IL:013',stockStatus:'instock',specialLabel:label('600999999')},{id:'online:iw:IL:600999999',stockStatus:'outofstock'}];
 const attach=withSource(rows),sl=id=>attach({id:'online:iw:IL:'+id}).specialLabel;
 assert.equal(sl('600000062').printed.enabled,false);assert.equal(sl('600000062').digital.enabled,true);assert.equal(sl('600000062').badge.enabled,true,'the digital badge stays');
 assert.equal(sl('011051542').printed.enabled,false);assert.equal(sl('011051542').badge.enabled,false,'the printed offer badge goes with it');
 assert.equal(sl('012193009'),rows[2].specialLabel,'both formats on sale: the feed\'s label as it is');
 assert.equal(sl('013').digital.enabled,false);assert.equal(sl('013').printed.enabled,true);
});
