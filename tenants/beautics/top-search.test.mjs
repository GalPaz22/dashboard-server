import test from 'node:test';
import assert from 'node:assert/strict';
import client from '../../pilot/beautics/client.json' with {type:'json'};
import {processProduct} from '../../pilot/beautics/core.mjs';
import {createSearchService} from '../../pilot/beautics/semantic.mjs';
import {createTopSearch} from './top-search.mjs';
import {searchBeautics} from './search.mjs';

// Merchant titles/category mistakes verified in the synced Beautics catalog.
const raw = (id,name,categories=[],extra={})=>({id,name,categories,price:69,status:'ACTIVE',stockStatus:'instock',...extra});
const source = [
  raw('shiny','shiny top tres jolie | שייני טופ (טופ ללא נטרול)',['טופים']),
  raw('english','tres jolie - peach veil top (top-it collection)',['חדש באתר','TRES JOLIE']),
  raw('refill','tres jolie - no sticky top(טופ ללא נטרול בצנצנת) 50 מ״ל',['בייסים']),
  raw('sparkle','sparkling top 19 - tres jolie(טופ נצנצים)',['טופים מנצנצים']),
  raw('topcoat','טופקוט | seche vive',['טופים']),
  raw('flash',"Top Flash (לק ג'ל פלאש טופ)",["לק ג'ל- צבעים"]),
  raw('splash',"ג'ל מתפשט tres jolie - (splash gel)",['חדש באתר','TRES JOLIE']),
  raw('oil','שמן הזנה לבנדר | 15 מ״ל | טופ נייל'),
  raw('spa','סבון עץ התה TOP-SPA',['טופ ספא']),
  raw('base','5 י״ח - Premium Base (בייס אקסטרא סמיך)',['טופים']),
  raw('linker','3 י״ח tres jolie – nail fresh (נייל פרש)',['טופים']),
  raw('primer','3 י״ח tres jolie – primer | פריימר לא חומצי',['טופים']),
  raw('mixed','בייס שקוף',['בייס/טופ/מקשרים']),
  raw('bloom','fixer gel - tres jolie (baby bloom)'),
];
const products = source.map(p=>processProduct(p,client));
const resolver = createTopSearch(products,client);
const expected = ['english','flash','refill','shiny','sparkle','topcoat'];

test('top aliases include English names and miscategorized tops, exclude brands and false category members',()=>{
  for (const query of ['טופ','טופים','top','TOP','top coat','טופ קוט','טופקוט']) {
    assert.deepEqual(resolver(query).matches.map(p=>p.id),expected,query);
  }
  for (const query of ['טופ נייל','שמן טופ נייל','top-spa','טופ ספא','בייס','לק סגול']) assert.equal(resolver(query),null,query);
});

test('spreading top maps to Splash Gel, preserving extra qualifiers and price',()=>{
  for (const query of ['טופ מתפשט','טופים מתפשטים','טופ מתפשט tres jolie','top blooming']) {
    assert.deepEqual(resolver(query).matches.map(p=>p.id),['splash'],query);
  }
  assert.equal(resolver('טופ מתפשט עד 68').matches.length,0);
  assert.equal(resolver('טופ מתפשט עד 69').matches.length,1);
  assert.equal(resolver('טופ מתפשט אדום').matches.length,0);
  assert.deepEqual(resolver('טופ ללא נטרול').matches.map(p=>p.id),['refill','shiny']);
});

test('stock, visibility and tenant restrictions apply to both types',()=>{
  const invisible = [
    ...['טופ',"ג'ל מתפשט"].flatMap((name,i)=>[
      processProduct(raw(`out${i}`,name,[],{stockStatus:'outofstock'}),client),
      processProduct(raw(`hidden${i}`,name,[],{hidden:true}),client),
      processProduct(raw(`draft${i}`,name,[],{status:'DRAFT'}),client),
      {...processProduct(raw(`foreign${i}`,name),client),tenantId:'other'},
    ]),
  ];
  const run = createTopSearch(invisible,client);
  assert.equal(run('טופ').matches.length,0);assert.equal(run('טופ מתפשט').matches.length,0);
});

test('service paginates every top without LLM; unsupported requests stay empty on cache hits',async()=>{
  let calls = 0;
  const run = createSearchService(products,client,async()=>{calls++;throw Error('Unexpected LLM')},{catalogSearch:resolver});
  let page = await run({query:'טופ',limit:2});const ids = page.matches.map(p=>p.id);
  while(page.nextCursor){page=await run({cursor:page.nextCursor,limit:2});ids.push(...page.matches.map(p=>p.id));}
  assert.deepEqual(ids,expected);
  for(let i=0;i<2;i++){
    const empty = await run({query:'טופ מתפשט אדום'});
    assert.equal(empty.total,0);assert.equal(empty.nextCursor,null);assert.equal(empty.metadata.neverEmpty,undefined);
  }
  assert.equal(calls,0);
});

test('production tenant adapter uses top rules before literal retrieval',async()=>{
  const collection={find(){return {limit(){return this},batchSize(){return this},async toArray(){return source},async close(){}}}};
  assert.deepEqual((await searchBeautics({collection,request:{query:'טופ',limit:50}})).matches.map(p=>p.id),expected);
  const spread = await searchBeautics({collection,request:{query:'טופ מתפשט'}});
  assert.deepEqual(spread.matches.map(p=>p.id),['splash']);assert.equal(spread.metadata.llmCalls,0);
});
