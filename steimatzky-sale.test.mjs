import test from 'node:test';
import assert from 'node:assert/strict';
import {storePrice} from './tenants/steimatzky/pricing.mjs';
import {createSalesRank,parseSaleQuery,saleListing} from './tenants/steimatzky/sale.mjs';
import {adaptRow,withSource} from './tenants/steimatzky/search.mjs';
import {decideMoment,presentProducts,searchCatalog} from './concierge.mjs';

const label=(printed,digital,badge)=>({type:'book_formats',printed:{enabled:true,value:printed,regular:null,badge},digital:digital?{enabled:true,regular:null,badge:null,...digital}:{enabled:false,value:null},badge:{enabled:!!badge,value:badge}});
const book=(sku,name,price,extra={})=>({id:'online:iw:IL:'+sku,name,price,stockStatus:'instock',url:'https://www.steimatzky.co.il/'+sku,...extra});

test('the price is what the label shows, the list price its regular price',()=>{
  const row=book('011324387','המטופלת השקטה',88.2,{salePrice:50,specialLabel:label(50,{value:29,regular:48,sku:'600001599'},'ספר50')});
  assert.deepEqual(storePrice(row),{price:50,regularPrice:88.2});
  const ebook=book('600001599','המטופלת השקטה',88.2,{salePrice:50,specialLabel:row.specialLabel});
  assert.deepEqual(storePrice(ebook),{price:29,regularPrice:48});
  assert.deepEqual(storePrice(book('1','בלי תווית',66.6,{salePrice:40,onSale:true})),{price:40,regularPrice:66.6});
  assert.deepEqual(storePrice(book('2','סוף מבצע',66.6,{salePrice:40,onSale:false})),{price:66.6,regularPrice:null});
  assert.deepEqual(storePrice(book('3','משחק',{value:62.9})),{price:62.9,regularPrice:null});
  assert.equal(adaptRow(row).price,50); assert.equal(adaptRow(row).regularPrice,88.2);
});

test('a search answers the store card with the list price and sale price it read before',()=>{
  const row=book('011324387','המטופלת השקטה',88.2,{salePrice:50,onSale:true,specialLabel:label(50,null,'ספר50')});
  const sent=withSource([row])(adaptRow(row));
  assert.equal(sent.price,88.2); assert.equal(sent.salePrice,50); assert.equal(sent.regularPrice,null);
});

test('only searches about the sale are read as such',()=>{
  const q=text=>parseSaleQuery(text);
  for(const text of ['ספרים ב10','ספרים ב-10₪','ספרים ב - 10 ש"ח','10 שקלים','ספרים ב10 ש״ח','ספרי ילדים בעשרה שקלים'])assert.equal(q(text)?.tier,10,text);
  assert.equal(q('ספרי ילדים בעשרה שקלים').audience,'kids');
  for(const text of ['בלאק פריידי','בלק פרידיי','black friday','מבצע','מבצעים בחנות','ספרים בהנחה','ספרים זולים','מבצע חורף ובלק פריידי','ספרים במבצע'])assert.ok(q(text),text);
  assert.equal(q('בלאק פריידי משחקים').kind,'games'); assert.equal(q('מבצעי פאזל').kind,'games'); assert.equal(q('קומיקס במבצע').audience,'comics'); assert.equal(q('ספרים עד 30 שקל').max,30);
  for(const text of ['מבצע ברלין','דיל עם אלוהים','מונופול דיל','פריידי מרגלית','holly black','בלאק','לאהוב 10','מה למדתי ב-40 השנים הראשונות','ספרים','קופון','ספרי השראה במבצע','מבצעים לחברי מועדון','יומנו של חנון 10','ספרים ב','1984'])assert.equal(q(text),null,text);
});

const campaign=[
  book('a','ספר בעשר',10,{specialLabel:label(10,null,'ספר10')}),
  book('b','ספר בחמישים',50,{specialLabel:label(50,null,'ספר50')}),
  book('c','TEN POUNDS',10,{specialLabel:label(10,null,'EN10')}),
  book('d','משחק בעשר',10,{specialLabel:label(10,null,'מבצע משחקים')}),
  book('e','דיגיטלי',88,{specialLabel:label(88,{value:24,badge:'₪ 24',sku:'600e'},null)}),
  book('f','בלי מבצע',10),
  book('g','אזל',10,{stockStatus:'outofstock',specialLabel:label(10,null,'ספר10')}),
  book('h','עוד ספר בעשר',10,{specialLabel:label(10,null,'ספר 10')}),
];

test('the listing holds the tier asked for, best sellers first, Hebrew books leading',()=>{
  const list=(text,sold)=>saleListing(campaign,parseSaleQuery(text),{sold}).map(p=>p.id.split(':').pop());
  assert.deepEqual(list('ספרים ב10',new Map([['h',5]])),['h','a','c']);
  assert.deepEqual(list('10 שקל'),['a','h','c','d']);
  assert.deepEqual(list('ספרים באנגלית ב10'),['c']);
  assert.deepEqual(list('ספרים דיגיטליים במבצע'),['e']);
  assert.deepEqual(list('בלאק פריידי').sort(),['a','b','c','d','e','h']);
});

test('the games sale follows the store list of games up to ₪50, ahead of other discounted games',()=>{
  const offer=[{enabled:true,value:'צעצועים ומשחקים 10 עד ₪50'}];
  const rows=[book('x','משחק יקר',98,{specialLabel:label(98,null,'מבצע משחקים')}),book('y','פנס',13.4,{specialLabel:{...label(13.4,null,null),offers:offer}}),book('z','יקר מדי',80,{specialLabel:{...label(80,null,null),offers:offer}})];
  assert.deepEqual(saleListing(rows,parseSaleQuery('בלאק פריידי משחקים'),{sold:new Map([['x',9]])}).map(p=>p.id.split(':').pop()),['y','x']);
});

test('a sale for children reads the store shelf of a book without categories',()=>{
  const rows=[book('k','אוצר',20,{department:'ספרים בעברית_ראשית קריאה',specialLabel:label(20,null,'ספר20')}),book('m','רומן',20,{department:'ספרים בעברית_סיפורת',specialLabel:label(20,null,'ספר20')})];
  assert.deepEqual(saleListing(rows,parseSaleQuery('ספרי ילדים ב20')).map(p=>p.id.split(':').pop()),['k']);
});

test('the sales rank counts copies in completed orders and waits for the first read',async()=>{
  const orders={find:()=>({toArray:async()=>[{items:[{id:'a',quantity:'2.00'}]},{items:[{id:'a',quantity:'1'},{id:'b'}]}]})};
  const rank=createSalesRank();
  assert.deepEqual([...await rank(orders)],[['a',3],['b',1]]);
});

function ctx(rows){
  const find=query=>({toArray:async()=>query?.id?.$in?rows.filter(r=>query.id.$in.includes(r.id)):query?.event_type?[]:rows});
  return {store:{dbName:'steimatzky',products:'products'},deps:{getMongoClient:async()=>({db:()=>({collection:()=>({find,aggregate:()=>({toArray:async()=>rows})})})}),getQueryEmbedding:async()=>null,getRedis:()=>null}};
}

test('the concierge reads and shows the sale price',async()=>{
  const found=await searchCatalog({query:'ספרים ב10'},ctx(campaign));
  assert.equal(found.products[0].price,10);
  const row=book('011324387','המטופלת השקטה',88.2,{salePrice:50,specialLabel:label(50,null,'ספר50')});
  const c=ctx([row]);c.shown=new Map([[row.id,{}]]);
  const [card]=(await presentProducts({product_ids:[row.id]},c)).products;
  assert.equal(card.price,50); assert.equal(card.regular_price,88.2);
  const budget=await searchCatalog({query:'המטופלת השקטה',price_max:60},ctx([row]));
  assert.equal(budget.products.length,1);
});

test('a sale search never opens the concierge as a missing product',async()=>{
  assert.equal(await decideMoment({query:'בלאק פריידי',repeats:3,shown:[],alternatives:true,ctx:ctx([])}),null);
});
