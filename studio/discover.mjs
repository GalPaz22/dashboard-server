import https from 'node:https';
import {lookup} from 'node:dns/promises';
export function publicAddress(address) {
 if(address.includes(':'))return false; // IPv4-only fetch boundary for this local release.
 const [a,b]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));
}
export async function fetchPublic(input, redirects=0) {
 const url=new URL(input);
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')throw Error('נדרשת כתובת HTTPS ציבורית');
 const answers=await lookup(url.hostname,{all:true,family:4});
 if(!answers.length||answers.some(x=>!publicAddress(x.address)))throw Error('כתובת רשת פנימית אינה מותרת');
 const {status,headers,body}=await new Promise((resolve,reject)=>{
  const req=https.get(url,{headers:{'User-Agent':'Semantix-Tenant-Studio/1.0'},lookup:(_h,options,cb)=>options.all?cb(null,[{address:answers[0].address,family:4}]):cb(null,answers[0].address,4)},res=>{
   let size=0;const chunks=[];
   res.on('data',c=>{size+=c.length;if(size>3*1024*1024)req.destroy(Error('Source exceeds 3 MB'));else chunks.push(c)});
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));res.on('error',reject);
  });req.setTimeout(15000,()=>req.destroy(Error('Source timeout')));req.on('error',reject);
 });
 if(status>=300&&status<400&&headers.location){if(redirects>=3)throw Error('Too many redirects');return fetchPublic(new URL(headers.location,url).href,redirects+1)}
 if(status!==200)throw Error('Source HTTP '+status);
 return body;
}
const text=s=>String(s??'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,code)=>{const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);return n>0&&n<=0x10ffff?String.fromCodePoint(n):''}).trim();
function product(raw,platform,origin) {
 if(platform==='shopify')return {id:String(raw.id),name:raw.title,url:origin+'/products/'+raw.handle,image:raw.images?.[0]?.src,price:Number(raw.variants?.[0]?.price),regularPrice:Number(raw.variants?.[0]?.compare_at_price)||null,stockStatus:raw.variants?.some(v=>v.available)?'instock':'outofstock',status:'ACTIVE',categories:[raw.product_type].filter(Boolean),tags:typeof raw.tags==='string'?raw.tags.split(',').map(x=>x.trim()):raw.tags||[]};
 return {id:String(raw.id),name:text(raw.name),url:raw.permalink,image:raw.images?.[0]?.src,price:Number(raw.prices?.price)/10**(raw.prices?.currency_minor_unit??2),regularPrice:Number(raw.prices?.regular_price)/10**(raw.prices?.currency_minor_unit??2),currency:raw.prices?.currency_code,stockStatus:raw.is_in_stock?'instock':'outofstock',status:'ACTIVE',categories:raw.categories?.map(c=>text(c.name))||[],tags:raw.tags?.map(t=>text(t.name))||[]};
}
export async function discover(url,platform,report=()=>{}) {
 const origin=new URL(url).origin;report('קריאת האתר והקטלוג הציבורי');
 const html=await fetchPublic(url);const title=text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||new URL(url).hostname);
 let products=[],warnings=[];
 if(['woocommerce','shopify'].includes(platform)) {
  for(let page=1;page<=5;page++){
   try {
    const path=platform==='shopify'?`/products.json?limit=100&page=${page}`:`/wp-json/wc/store/v1/products?per_page=100&page=${page}`;
    const data=JSON.parse(await fetchPublic(origin+path));const rows=platform==='shopify'?data.products:data;
    if(!Array.isArray(rows))throw Error('Feed shape not supported');
    products.push(...rows.map(r=>product(r,platform,origin)));report(`נקראו ${products.length} מוצרים`);
    if(rows.length<100)break;
    if(page===5)warnings.push('הייבוא מוגבל למדגם של 500 מוצרים; נדרש סנכרון מלא לפני הפעלה.');
   }catch(error){warnings.push(error.message);break;}
  }
 }
 if(!products.length) {
  for(const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
   try {const data=JSON.parse(match[1]);const walk=node=>{if(!node||typeof node!=='object')return;
    if(node['@type']==='Product'&&node.name){const offer=Array.isArray(node.offers)?node.offers[0]:node.offers;products.push({id:String(node.sku||node['@id']||products.length),name:node.name,url:node.url||url,image:Array.isArray(node.image)?node.image[0]:node.image,price:Number(offer?.price)||null,status:'ACTIVE',stockStatus:String(offer?.availability).endsWith('/InStock')?'instock':'unknown',categories:node.category?[String(node.category)]:[],tags:[]})}
    for(const value of Object.values(node))if(value&&typeof value==='object'){if(Array.isArray(value))value.forEach(walk);else walk(value)}
   };walk(data)}catch{}
  }
  warnings.push('נאסף רק מידע מובנה מהעמוד. נדרש פיד או מחבר מורשה לסנכרון מלא.');
 }
 products=[...new Map(products.slice(0,500).map(p=>[p.id,p])).values()];
 return {title,products,warnings,sourceUrl:url,platform,capturedAt:new Date().toISOString(),sample:true};
}
