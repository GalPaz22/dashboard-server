import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchIndex,createIndexRetriever} from './tenants/steimatzky/engine/core/search-index.mjs';
import {createSearchService} from './tenants/steimatzky/engine/core/semantic.mjs';

// The rejects of the conversion report of 09.11.2026: a series asked as "סדרת ...", an author's name with a title, a
// product that exists but is not on sale, a blurb hit taken for an English title, another book of the same author taken
// for the work's edition, and searches that waited a minute.
const profile={tenantId:'t',productTypes:{},colors:{},finishes:{},tagDefinitions:{},queryAliases:{},badgeRules:[],pipeline:{outOfStock:'hide',seriesOrder:true}};
const book=(id,title,extra={})=>({id,tenantId:'t',title,description:'',categories:[],tags:[],colors:[],finishes:[],stockStatus:'instock',hidden:false,price:80,specifications:{},...extra});
const plan=extra=>({intent:'',categories:[],terms:[],requirements:[],maxPrice:null,minPrice:null,colors:[],finishes:[],tags:[],clarification:'',...extra});
const setup=(products,generate,options={})=>createSearchService(products,profile,generate,{retrieve:createIndexRetriever(products,profile,buildSearchIndex(products,'1')),lightweightRouter:false,expansion:'sparse',expandBelow:5,...options});
const ids=r=>r.matches.map(p=>p.id);
const scripted=answers=>{const calls=[];const generate=async({stage,prompt})=>{calls.push({stage,prompt});const next=answers[stage]?.shift();if(next instanceof Error)throw next;if(next===undefined)throw Error('unexpected '+stage);return {data:next};};generate.calls=calls;return generate;};
const noModel=()=>{throw Error('no model call expected');};

const series=()=>[book('nat','הטבעיים 3 להמר על הכול',{specifications:{author:'אחר'}}),book('v2','על הכול 2 להילחם על הכול',{specifications:{author:'אשלי'}}),
 book('v1','על הכול 1 לוותר על הכול',{specifications:{author:'אשלי'}}),book('blurb','עד אחרי הנצח',{description:'סדרת רומנים על הכל ועל אהבה'}),book('x','ספר אחר')];

test('a series asked as "סדרת ..." in either spelling: its volumes first, in order, from the index',async()=>{
 for(const q of ['סדרת על הכל','סדרת על הכול','על הכול','על הכל']){
  const r=await setup(series(),noModel)({query:q,limit:12});
  assert.deepEqual(ids(r).slice(0,2),['v1','v2'],q);assert.equal(r.metadata.llmUsed,false,q);assert.ok(!ids(r).includes('blurb'),q);
 }
});

test('an author\'s name with a title of theirs answers from the index, the name first or last',async()=>{
 const products=[book('b1','נולדו לדם 1 ברית של כבוד',{specifications:{author:'קורה ריילי'}}),book('b2','נולדו לדם 2 ברית של חובה',{specifications:{author:'קורה ריילי'}}),
  book('other','נולדו לדם',{specifications:{author:'מישהו אחר'}}),book('k','קאמורה קרטל 1',{specifications:{author:'קורה ריילי'}})];
 for(const q of ['קורה ריילי נולדו לדם','נולדו לדם קורה ריילי']){
  const r=await setup(products,noModel)({query:q,limit:12});
  assert.equal(r.metadata.phase,'author-title',q);assert.deepEqual(ids(r).slice(0,2).sort(),['b1','b2'],q);assert.ok(!ids(r).includes('other'),q);
 }
});

test('the exact product is retired from the store: said so, its author\'s other books, then its own department, no model',async()=>{
 const products=[book('gone','התאמות לפעוטות',{hidden:true,stockStatus:'outofstock',categories:['צעצועים']}),
  book('toy','משחק התאמות עץ',{categories:['צעצועים']}),book('toy2','קוביות לפעוטות',{categories:['צעצועים']}),book('bk','ספר צבעים לפעוטות',{categories:['ספרים']}),
  book('wp','WEDDING PEOPLE',{hidden:true,stockStatus:'outofstock',specifications:{author:'ESPACH, ALISON'},categories:['ספרים באנגלית']}),
  book('notes','NOTES ON YOUR SUDDEN DISAPPEARANCE',{specifications:{author:'ESPACH, ALISON'},categories:['ספרים באנגלית']}),book('en','OTHER BOOK',{categories:['ספרים באנגלית']})];
 const search=setup(products,noModel);
 const toys=await search({query:'התאמות לפעוטות',limit:12});
 assert.equal(toys.metadata.phase,'unavailable');assert.match(toys.message,/אזל במלאי/);assert.deepEqual(ids(toys).slice(0,2).sort(),['toy','toy2']);assert.ok(!ids(toys).includes('bk'));
 assert.equal(toys.metadata.requestedProduct.id,'gone');assert.equal(toys.metadata.closestFallback,true);
 const wedding=await search({query:'wedding people',limit:12});
 assert.equal(ids(wedding)[0],'notes');assert.equal(wedding.matches[0].alternativeReason,'ספר אחר של אותו מחבר');
});

test('an English title the store lacks: a product the selector took by its blurb is dropped, and the answer says the title was not found',async()=>{
 const products=[book('field','PLAYING THE FIELD',{description:'the star striker of the team',categories:['ספרים באנגלית']}),book('fic','SOME NOVEL',{categories:['ספרים באנגלית']})];
 const generate=scripted({interpret:[plan({intent:'ספר',categories:['ספרים באנגלית'],terms:['the striker','striker'],requirements:['the striker']})],
  select:[{matches:[{id:'field',evidence:[{requirement:0,field:'description',quote:'striker'}]}],alternatives:[]},{matches:[],departments:['ספרים באנגלית']}]});
 const r=await setup(products,generate)({query:'the striker',limit:12});
 assert.equal(r.metadata.closestFallback,true);assert.equal(r.metadata.titleNotFound,true);assert.match(r.message,/לא מצאנו בחנות את "the striker"/);
 assert.ok(r.matches.every(p=>p.matchQuality==='alternative'));
});

test('the same author\'s other book is not the work\'s edition when the store has the local title itself',async()=>{
 const products=[book('work','דרך האמן בעבודה',{specifications:{author:'ג’וליה קמרון'}}),book('way','דרך האמן',{specifications:{author:'ג’וליה קמרון'}})];
 const generate=scripted({interpret:[plan({intent:'ספר',terms:['דרך האמן','Julia Cameron'],requirements:["the artist's way"]})],
  select:[{matches:[{id:'work',evidence:[{requirement:0,field:'title',quote:'דרך האמן'}]},{id:'way',evidence:[{requirement:0,field:'title',quote:'דרך האמן'}]}],alternatives:[]}]});
 const r=await setup(products,generate)({query:"the artist's way",limit:12});
 assert.equal(ids(r)[0],'way');assert.equal(r.matches[0].matchQuality,'edition');assert.notEqual(r.matches[1]?.matchQuality,'edition');
});

test('a model that does not answer is cut at the budget: the search still ends with products',async()=>{
 const products=[book('a','ספר על דרקונים',{categories:['פנטזיה']}),book('b','ספר על חדי קרן',{categories:['פנטזיה']})];
 const hang=({signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
 const started=Date.now(),r=await setup(products,hang,{budgetMs:400,deepBudgetMs:200})({query:'משהו קסום לילדה בת שמונה',limit:12});
 assert.ok(Date.now()-started<2000,'answered within the budget');assert.ok(r.matches.length>0);
});
