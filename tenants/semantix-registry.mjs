import {readdir,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
export const REGISTRY_VERSION=4;
// Mounts every tenants/<slug>/ folder that has a semantix.module.json. Modules load lazily on the first request.
// Whether a module answers is a field on the merchant's user document (users.users), which dashboard-server copies into
// req.store.semantix:  {module:"<slug>", enabled:true, percent:100}
//   - module must be this module's slug and the store's dbName must be the module's dbName;
//   - enabled:false (or no field) → the existing search answers; percent < 100 → that share of shoppers (stable per session);
// Store config is cached by dashboard-server (5 minutes), so a change reaches the server within that time.
// Circuit breaker: 5 failures within a minute pause the module for 5 minutes; failed searches fall through to the
// existing pipeline, so shoppers get the old search rather than an error.
export const userSwitch=store=>{const s=store?.semantix;if(!s||typeof s!=='object')return null;const percent=Number(s.percent);
 return {module:String(s.module||''),enabled:s.enabled===true,percent:Number.isFinite(percent)?Math.max(0,Math.min(100,percent)):100};};
export function createSemantixTenants({getDb,dir=new URL('./',import.meta.url),now=Date.now,breaker={failures:5,windowMs:60000,coolMs:300000}}={}){
 let loading=null;const state=new Map();
 const tenant=slug=>{if(!state.has(slug))state.set(slug,{failures:[],openUntil:0,served:0,fellBack:0,lastError:null});return state.get(slug);};
 function decide(manifest,store){
  const sw=userSwitch(store);
  if(!sw||sw.module!==manifest.slug)return {on:false,source:sw?'user-other-module':'user-no-field'};
  if(store?.dbName!==manifest.dbName)return {on:false,source:'db-mismatch'};
  return {on:sw.enabled,percent:sw.percent,source:'user'};
 }
 const bucket=req=>{const key=String(req.body?.session_id||req.body?.sessionId||req.query?.session_id||req.get?.('X-Session-Id')||req.ip||'');return parseInt(createHash('sha1').update(key).digest('hex').slice(0,8),16)%100;};
 // Every decision for the module's own store is visible: X-Semantix-Decision on the response, and a log line per
 // module per minute (so "why is the old search answering?" is answered from DevTools or the server log).
 const logged=new Map();
 function explain(manifest,req,verdict){
  if(req.store?.dbName!==manifest.dbName)return;if(!req.res?.headersSent)req.res?.setHeader('X-Semantix-Decision',manifest.slug+' '+verdict);
  const key=manifest.slug+verdict,at=now();if(at-(logged.get(key)||0)<60000)return;logged.set(key,at);
  console.log('[SEMANTIX '+manifest.slug+'] decision',verdict,'| user field',JSON.stringify(req.store?.semantix??null));
 }
 function allowed(manifest,req){const d=decide(manifest,req.store),t=tenant(manifest.slug);
  const verdict=!d.on?'off:'+(d.source==='user'?'enabled-false':d.source):t.openUntil>now()?'off:circuit-open':d.percent>=100||bucket(req)<d.percent?'on':'off:rollout-'+d.percent+'%';
  explain(manifest,req,verdict);return verdict==='on';}
 function failed(slug,error){const t=tenant(slug),at=now();t.lastError={message:error.message,at:new Date(at).toISOString()};t.fellBack++;t.failures=[...t.failures.filter(x=>at-x<breaker.windowMs),at];
  if(t.failures.length>=breaker.failures){t.openUntil=at+breaker.coolMs;t.failures=[];console.error('[SEMANTIX] circuit open for',slug,'until',new Date(t.openUntil).toISOString());}}
 const load=()=>loading??=(async()=>{const routes=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){if(!entry.isDirectory())continue;const folder=new URL(entry.name+'/',dir);
   try{JSON.parse(await readFile(new URL('semantix.module.json',folder),'utf8'));}catch{continue;}
   try{const mod=await import(pathToFileURL(new URL('index.mjs',folder).pathname).href),manifest=mod.manifest;
    routes.push(mod.createTenantRoutes({getDb,enabled:req=>allowed(manifest,req),onError:e=>failed(manifest.slug,e),onServed:()=>{tenant(manifest.slug).served++;}}));}
   catch(e){console.error('[SEMANTIX] failed to load tenant',entry.name,e.message);}}
  return routes;})();
 const chain=kind=>async(req,res,next)=>{let routes;try{routes=await load();}catch(e){console.error('[SEMANTIX]',e.message);return next();}
  let i=0;const step=()=>i<routes.length?routes[i++][kind](req,res,step):next();return step();};
 return {
  search:chain('search'),loadMore:chain('loadMore'),
  // Per module: what is loaded, which users switch it on (users.users.semantix), circuit state and counters since start.
  async status(){const routes=await load();let users=[],usersError=null;
   try{users=await (await getDb('users')).collection('users').find({'semantix.module':{$in:routes.map(r=>r.manifest.slug)}},{projection:{_id:0,username:1,dbName:1,semantix:1}}).toArray();}catch(e){usersError=e.message;}
   return {usersError,
    tenants:routes.map(r=>{const m=r.manifest,t=tenant(m.slug),u=users.filter(x=>x.semantix?.module===m.slug);return {slug:m.slug,dbName:m.dbName,revision:m.revision,builtAt:m.builtAt,
     users:u.map(x=>({username:x.username,dbName:x.dbName,...userSwitch({semantix:x.semantix}),matchesDb:x.dbName===m.dbName,updatedAt:x.semantix?.updatedAt||null})),
     circuitOpenUntil:t.openUntil>now()?new Date(t.openUntil).toISOString():null,served:t.served,fellBack:t.fellBack,lastError:t.lastError};})};},
  // GET handler for operators: requires SEMANTIX_ADMIN_TOKEN in X-Semantix-Admin.
  async statusRoute(req,res){const token=process.env.SEMANTIX_ADMIN_TOKEN;if(!token||req.get('X-Semantix-Admin')!==token)return res.status(404).end();res.set('Cache-Control','no-store').json(await this.status());}
 };
}
