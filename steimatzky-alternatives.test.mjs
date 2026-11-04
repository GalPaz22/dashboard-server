import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchIndex,createIndexRetriever} from './tenants/steimatzky/engine/core/search-index.mjs';
import {createSearchService} from './tenants/steimatzky/engine/core/semantic.mjs';
import {layoutSwap,transliterates} from './tenants/steimatzky/engine/core/names.mjs';
import {authorMatch} from './tenants/steimatzky/engine/core/core.mjs';
import {mergeLive} from './tenants/steimatzky/search.mjs';
import {searchMeta} from './search-logging.mjs';

// The cases of the alternatives audit of 04.11.2026: what must answer without the model, what must stay a question or a
// failure, and when closest alternatives may be shown.
const profile={tenantId:'t',productTypes:{},colors:{},finishes:{},tagDefinitions:{},queryAliases:{},badgeRules:[],pipeline:{outOfStock:'hide'}};
const book=(id,title,extra={})=>({id,tenantId:'t',title,description:'',categories:[],tags:[],colors:[],finishes:[],stockStatus:'instock',hidden:false,price:80,specifications:{},...extra});
const plan=extra=>({intent:'',categories:[],terms:[],requirements:[],maxPrice:null,minPrice:null,colors:[],finishes:[],tags:[],clarification:'',...extra});
const noModel=()=>{throw Error('This search must not need a model');};
const setup=(products,generate=noModel,options={})=>{
 const retrieve=createIndexRetriever(products,profile,buildSearchIndex(products,'1'));
 return createSearchService(products,profile,generate,{retrieve,lightweightRouter:false,expansion:'sparse',expandBelow:5,...options});
};
const ids=r=>r.matches.map(p=>p.id);
// A scripted model: each stage answers from its own list, and every call is recorded.
const scripted=answers=>{const calls=[];const generate=async({stage,prompt})=>{calls.push({stage,prompt});const next=answers[stage]?.shift();if(next instanceof Error)throw next;if(next===undefined)throw Error('unexpected '+stage);return {data:next};};generate.calls=calls;return generate;};

test('a title holding every typed word answers at once, before "לא" is read as a condition, without the model',async()=>{
 const products=[book('hat','זה לא הכובע שלי'),book('mine','זה לא שלי'),book('blurb','ספר אחר',{description:'זה לא שלי בכלל'}),book('problem','מה עושים עם בעיה ?')];
 const search=setup(products);
 const a=await search({query:'זה לא שלי',limit:12});
 assert.deepEqual(ids(a),['mine','hat','blurb'],'exact title, other titles, then a blurb that mentions the words');assert.equal(a.metadata.llmUsed,false);
 const b=await search({query:'מה עושים עם בעיה',limit:12});assert.deepEqual(ids(b),['problem']);assert.equal(b.metadata.llmUsed,false);
 // A single word in a title answers too, even with fewer literal matches than the expansion threshold.
 const c=await setup([book('n','סיפורי ממלכת נרניה בכרך אחד'),book('l','האריה המכשפה וארון הבגדים',{description:'הספר הראשון בסדרת נרניה'})])({query:'נרניה',limit:12});
 assert.deepEqual(ids(c),['n','l']);assert.equal(c.metadata.llmUsed,false);
});

test('"ללא" in a request that is no product name is still a condition for the model',async()=>{
 const products=[book('gf','מתכונים ללא גלוטן',{categories:['בישול']}),book('cake','עוגות עם גלוטן',{categories:['בישול']})];
 const generate=scripted({interpret:[plan({intent:'ספר בישול ללא גלוטן',terms:['גלוטן'],requirements:['ספר בישול','ללא גלוטן']})],select:[{matches:[{id:'gf',evidence:[{requirement:0,field:'title',quote:'מתכונים'},{requirement:1,field:'title',quote:'ללא גלוטן'}]}],alternatives:[]}]});
 const r=await setup(products,generate)({query:'ספר בישול ללא גלוטן',limit:12});
 assert.deepEqual(ids(r),['gf']);assert.deepEqual(generate.calls.map(c=>c.stage),['interpret','select']);
});

test('a question from the model still ends with products, and keeps the question',async()=>{
 const generate=scripted({interpret:[plan({intent:'?',clarification:'לאיזה גיל?'})],select:[{matches:[],departments:['ילדים']}]});
 const r=await setup([book('a','ספר כלשהו'),book('k','ספר ילדים',{categories:['ילדים'],popularity:5})],generate)({query:'משהו טוב',limit:12});
 assert.equal(r.status,'matched');assert.deepEqual(ids(r),['k']);assert.equal(r.metadata.clarification,'לאיזה גיל?');assert.equal(r.metadata.alternativesFrom,'department');
});

test('a failed model call still shows products, without another call, and is not cached',async()=>{
 const products=[book('a','רומן דואט 1',{popularity:1}),book('g','משחק שם קוד',{categories:['משחקים']}),book('x','קלפים',{categories:['משחקים'],popularity:9})];
 const generate=scripted({interpret:[Error('503 overloaded'),Error('503 overloaded'),Error('503'),Error('503')]});
 const search=setup(products,generate);
 const r=await search({query:'שם קוד דואט',limit:12});
 assert.equal(r.status,'matched');assert.equal(r.metadata.failureReason,'llm-failure');assert.match(r.metadata.failureDetail,/503/);
 assert.equal(ids(r)[0],'g','the product holding two of the name\'s words leads; a novel sharing one word does not');
 assert.deepEqual(generate.calls.map(c=>c.stage),['interpret','interpret'],'one retry, then no alternatives call');
 generate.calls.length=0;await search({query:'שם קוד דואט',limit:12});assert.equal(generate.calls[0]?.stage,'interpret','the next try asks again');
});

test('a missing product gets alternatives the model confirms, then its department; never nothing',async()=>{
 const products=[book('s1','שירים של שטיינבק',{specifications:{author:'ג׳ון סטיינבק'},categories:['סיפורת']}),book('x','ספר על עדן'),book('f','רומן אחר',{categories:['סיפורת'],popularity:3})];
 const ok=scripted({interpret:[plan({intent:'קדמת עדן',terms:['סטיינבק'],requirements:['east of eden']})],select:[{matches:[],alternatives:[{id:'s1',reason:'אותו סופר',missing:[]}]}]});
 const r=await setup(products,ok)({query:'east of eden',limit:12});
 assert.deepEqual(ids(r),['s1']);assert.equal(r.metadata.rankedByModel,true);assert.equal(r.matches[0].matchQuality,'alternative');
 const none=scripted({interpret:[plan({intent:'x',terms:['פלוני'],requirements:['ספר פלוני אלמוני']})],select:[{matches:[],departments:['סיפורת']}]});
 const r2=await setup(products,none)({query:'ספר פלוני אלמוני',limit:12});
 assert.deepEqual(ids(r2),['f','s1'],'popular products of the department the model named');assert.equal(r2.metadata.alternativesFrom,'department');assert.equal(r2.metadata.rankedByModel,false);
});

test('a bare name gets its own kind of product, not products that share one of its words',async()=>{
 const products=[book('n1','רומן דואט 1',{categories:['רומנטי'],popularity:9}),book('n2','נסיכה דואט מלכותי',{categories:['רומנטי']}),book('hidden','שם קוד דיסני',{categories:['משחקי קופסא'],hidden:true}),
  book('g1','קטאן',{categories:['משחקי קופסא'],popularity:5}),book('g2','דוביל',{categories:['משחקי קופסא'],popularity:7})];
 const generate=scripted({interpret:[plan({intent:'משחק',terms:['דואט'],requirements:['שם קוד דואט']})],
  select:[{matches:[],alternatives:[{id:'n1',reason:'דואט',missing:[]},{id:'n2',reason:'דואט',missing:[]}]},{matches:[],departments:['משחקי קופסא']}]});
 const r=await setup(products,generate)({query:'שם קוד דואט',limit:12});
 assert.deepEqual(ids(r),['g2','g1'],'popular board games; the "דואט" novels go');
 const second=generate.calls.at(-1).prompt;assert.match(second,/שם קוד דיסני/,'the hidden namesake tells the model what the name is');
});

test('the store\'s current name is searchable beside the published title, and a rename reaches the card',async()=>{
 const card=book('online:iw:IL:105570663','MONKEY AROUND קופים מסביב');
 const rows=[{id:'online:iw:IL:105570663',name:'הקוף השובב',price:89.9,stockStatus:'instock'}];
 const [merged]=mergeLive([card],rows,profile,'t');
 assert.equal(merged.sourceTitle,'הקוף השובב');assert.equal(merged.title,'MONKEY AROUND קופים מסביב');
 const search=setup([merged,book('drum','הקוף והתוף')]);
 for(const query of ['הקוף השובב','MONKEY AROUND קופים מסביב'])assert.equal(ids(await search({query,limit:12}))[0],'online:iw:IL:105570663',query);
 assert.equal(mergeLive([card],[{...rows[0],name:'MONKEY AROUND קופים מסביב'}],profile,'t')[0].sourceTitle,undefined,'the same name adds nothing');
 const hidden=mergeLive([card],[{...rows[0],hidden:true}],profile,'t')[0];assert.equal(hidden.hidden,true,'hiding still applies');
});

test('author names: adjacent swaps, sound-alike letters, the other script and "LAST, FIRST"',async()=>{
 const products=[
  book('j1','אמור שתזכור אותי',{specifications:{author:'אבי חימנז'}}),
  book('f1','HOUSEMAID',{specifications:{author:'MCFADDEN, FREIDA'}}),book('f2','עוזרת הבית',{specifications:{author:'פרידה מקפדן'}}),
  book('h1','חיים קטנים',{specifications:{author:'האניה ינגיהארה'}}),book('c1','על הכול',{specifications:{author:'אבישג צ’רחי'}}),
  book('noise','שירי אהבה',{description:'אבי ואמא'}),
 ];
 const search=setup(products,noModel,{expansion:'off'});
 for(const [query,want] of [['אבי חמינז',['j1']],['Frieda McFadden',['f1','f2']],['Freida McFadden',['f1','f2']],['Hanya yanagihara',['h1']],["אבישג צ'רכי",['c1']]]){
  const r=await search({query,limit:12});assert.deepEqual(ids(r).sort(),want.sort(),query);assert.equal(r.metadata.llmUsed,false,query);
 }
 assert.ok(authorMatch(products[1],'freida mcfadden'),'"LAST, FIRST" is one author');assert.ok(authorMatch(products[1],'mcfadden'),'and the surname alone');
 assert.ok(transliterates('colleen','קולין')&&transliterates('hoover','הובר')&&!transliterates('king','מלך'));
});

test('a query typed on the wrong keyboard layout is converted only when a title then has all its words',async()=>{
 assert.deepEqual(layoutSwap('nv guaho go cghv'),{to:'he',text:'מה עושים עם בעיה'});
 const products=[book('p','מה עושים עם בעיה ?'),book('v','VERITY'),book('noise','ספר',{description:'verity'})];
 const search=setup(products);
 const r=await search({query:'nv guaho go cghv',limit:12});assert.deepEqual(ids(r),['p']);assert.equal(r.metadata.correction.source,'keyboard-layout');
 assert.equal(ids(await search({query:'verity',limit:12}))[0],'v','valid English is searched as typed');
});

test('the query log keeps why the module answered and the ids it showed',()=>{
 const meta=searchMeta({status:'matched',products:[{id:'online:iw:IL:1',name:'a',matchQuality:'alternative'},{id:'online:iw:IL:2',name:'b'}],metadata:{mode:'llm',revision:39,failureReason:'llm-rejected-all',rankedByModel:true,closestFallback:true,candidateCount:24,candidatesTruncated:true,llmCalls:3,exactMatch:false,fullMatch:false,correction:{from:'x',to:'y',source:'catalog-author'},usage:[{a:1}]}},120);
 assert.deepEqual(meta,{elapsedMs:120,searchMode:'llm',searchRevision:39,failureReason:'llm-rejected-all',exactMatch:false,fullMatch:false,rankedByModel:true,closestFallback:true,candidateCount:24,candidatesTruncated:true,llmCalls:3,searchStatus:'matched',correction:{from:'x',to:'y',source:'catalog-author'},deliveredIds:['online:iw:IL:1','online:iw:IL:2'],deliveredQuality:['alternative',null]});
});

test('one weak verified product is followed by related candidates; a word inside another word is no relation',async()=>{
 const products=[book('v','במהירות שיא'),book('d1','ציור בעיפרון למתחילים'),book('d2','לימוד ציור',{description:'טכניקות ציור'}),book('x','עצב הוואגוס')];
 const generate=scripted({interpret:[plan({intent:'ספר ציור',terms:['ציור'],requirements:['לימוד ציור בעיפרון']})],select:[{matches:[{id:'d2',evidence:[{requirement:0,field:'title',quote:'לימוד ציור'}]}],alternatives:[]}]});
 const r=await setup(products,generate)({query:'לימוד ציור בעיפרון',limit:12});
 assert.equal(ids(r)[0],'d2');assert.ok(ids(r).includes('d1'),'another drawing book follows');assert.ok(!ids(r).includes('x'));
 assert.equal(r.matches.find(p=>p.id==='d1').matchQuality,'alternative');
 const ego=scripted({interpret:[plan({intent:'ספר',terms:['אגו'],requirements:['ספר עיון בשם אגו הוא האויב מאת רייאן הולידיי']})],select:[{matches:[],alternatives:[{id:'x',reason:'אגו',missing:[]}]},{matches:[],departments:[]}]});
 const r2=await setup([...products,book('e','האדם שבקצה האגו')],ego)({query:'אגו זה האויב',limit:12});
 assert.ok(!ids(r2).includes('x'),'"אגו" is not in "הוואגוס"');assert.equal(ids(r2)[0],'e');
});
