// Local snapshot API; bounded Gemini fallback. No production imports or database writes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { autocomplete } from './core.mjs';
import { createSearchService } from './semantic.mjs';
import { generate } from './gemini.mjs';
const client = JSON.parse(await readFile(new URL('./client.json',import.meta.url)));
const products = JSON.parse(await readFile(new URL('../../outputs/beautics-pilot/products.json',import.meta.url)));
const runSearch=createSearchService(products,client,generate);
const assets = new Map(await Promise.all([['/','preview.htm','text/html'],['/preview.css','preview.css','text/css'],['/preview.mjs','preview.mjs','text/javascript']].map(async([path,file,type])=>[path,{body:await readFile(new URL(file,import.meta.url)),type}])));
const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  try {
    if(!['127.0.0.1:4318','localhost:4318'].includes(req.headers.host)){res.statusCode=403;return res.end(JSON.stringify({error:'Local preview only'}));}
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method==='GET' && assets.has(url.pathname)){const asset=assets.get(url.pathname);res.setHeader('Content-Type',asset.type+'; charset=utf-8');return res.end(asset.body);}
    if(req.method==='GET' && url.pathname==='/review')return res.end(JSON.stringify({products:products.filter(p=>!p.hidden && p.badges.length)}));
    if(req.method==='GET' && url.pathname==='/autocomplete') return res.end(JSON.stringify({suggestions:autocomplete(products,client,url.searchParams.get('query')||'')}));
    if(req.method==='POST' && url.pathname==='/search') {
      if((req.headers.origin&&!['http://127.0.0.1:4318','http://localhost:4318'].includes(req.headers.origin))||!req.headers['content-type']?.startsWith('application/json')){res.statusCode=403;return res.end(JSON.stringify({error:'Same-origin JSON required'}));}
      let body=''; for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)throw new Error('Request too large');}
      return res.end(JSON.stringify(await runSearch(JSON.parse(body))));
    }
    res.statusCode=404;res.end(JSON.stringify({error:'Use GET /autocomplete or POST /search'}));
  }catch{res.statusCode=400;res.end(JSON.stringify({error:'Invalid request or stale cursor'}));}
});
server.listen(4318,'127.0.0.1',()=>console.log('Beautics offline pilot: http://127.0.0.1:4318'));
