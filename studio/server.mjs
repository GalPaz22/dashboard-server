import 'dotenv/config';
import express from 'express';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createStore} from './store.mjs';
import {discover} from './discover.mjs';
import {askAgent,contract,validateProfile} from './model.mjs';
import {createDraftRuntime,indexDefinition} from './runtime.mjs';
import {provision} from './provision.mjs';
import {buildArtifacts} from './artifacts.mjs';
import {zipFiles} from './zip.mjs';
const dir=fileURLToPath(new URL('.',import.meta.url));
const store=createStore(resolve(process.env.STUDIO_DATA_DIR||dir+'data'));
const locks=new Set(),runtimes=new Map();let active=0;
const port=Number(process.env.STUDIO_PORT||4320),token=randomUUID();
const app=express();app.use(express.json({limit:'32kb'}));
app.use((req,res,next)=>{
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return res.sendStatus(403);
 if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return res.sendStatus(403);
 res.set('Cache-Control','no-store');next();
});
app.get('/api/session',(_req,res)=>res.json({token}));
app.use('/api', (req,res,next)=>{
 const value=req.get('X-Studio-Token')||'';
 if(value.length!==token.length||!timingSafeEqual(Buffer.from(value),Buffer.from(token)))return res.sendStatus(403);
 next();
});
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
async function locked(id,fn){if(locks.has(id)||active>=2)throw Error('כבר מתבצעת פעולה. נסו שוב בעוד רגע.');locks.add(id);active++;try{return await fn()}finally{locks.delete(id);active--}}
function summary(p){return {...p,catalog:p.catalog?{...p.catalog,products:undefined,count:p.catalog.products.length}:null}}
async function persist(p){p.events=p.events.slice(-100);p.updatedAt=new Date().toISOString();return store.save(p)}
async function runtime(id){const p=await store.read(id);if(!p.revisions.length)throw Error('עדיין לא נוצר מודול');const revision=p.revisions.at(-1),key=id+':'+revision.number;if(!runtimes.has(key)){runtimes.clear();runtimes.set(key,createDraftRuntime(p,revision))}return runtimes.get(key)}
app.get('/api/projects',route(async(_req,res)=>res.json(await store.list())));
app.get('/api/projects/:id',route(async(req,res)=>res.json(summary(await store.read(req.params.id)))));
app.post('/api/projects',route(async(req,res)=>{
 const {url,platform}=req.body;const parsed=new URL(url);if(parsed.protocol!=='https:'||!['shopify','woocommerce','magento','custom'].includes(platform))throw Error('בחרו כתובת HTTPS ופלטפורמה');
 if((await store.list()).length>=30)throw Error('מגבלת 30 פרויקטים מקומיים');
 const p={id:randomUUID(),url:parsed.href,platform,name:parsed.hostname,status:'created',events:[],messages:[],revisions:[],updatedAt:new Date().toISOString()};await persist(p);res.json(summary(p));
}));
app.post('/api/projects/:id/build',route(async(req,res)=>{
 const id=req.params.id;const p=await store.read(id);
 if(p.revisions.length>=100)throw Error('מגבלת 100 גרסאות');
 if(locks.has(id)||active>=2)return res.status(409).json({error:'כבר מתבצעת פעולה'});
 // The saved project is the durable checkpoint. The UI polls its event log.
 const work=locked(id,async()=>{
  try {
   p.status='discovering';p.events.push({text:'מתחילים לחקור את האתר',at:new Date().toISOString()});await persist(p);
   p.catalog=await discover(p.url,p.platform,text=>p.events.push({text,at:new Date().toISOString()}));
   p.status='designing';p.events.push({text:`נאספו ${p.catalog.products.length} מוצרים; מתכננים מודול`,at:new Date().toISOString()});await persist(p);
   if(!p.catalog.products.length)throw Error('לא נמצא קטלוג ציבורי. יש לחבר פיד או הרשאות לפלטפורמה.');
   const answer=await askAgent(contract+'\nDesign a tenant search profile from this catalog. Do not assume beauty unless supported.\nDATA '+JSON.stringify({title:p.catalog.title,platform:p.platform,products:p.catalog.products.slice(0,50)}));
   const profile=validateProfile(answer.profile);p.revisions.push({number:p.revisions.length+1,profile,createdAt:new Date().toISOString(),note:'יצירה מהקטלוג'});p.name=profile.name;p.status='draft';p.messages.push({role:'assistant',text:String(answer.message||'המודול מוכן לבדיקה')});p.events.push({text:'נוצרו פרופיל, הגדרת אינדקס ומודול לחיפוש בתצוגת ניסיון',at:new Date().toISOString()});
  }catch(error){p.status='failed';p.events.push({text:error.message,at:new Date().toISOString()})}
  await persist(p);
 });work.catch(console.error);res.status(202).json({started:true});
}));
app.post('/api/projects/:id/chat',route(async(req,res)=>locked(req.params.id,async()=>{
 const p=await store.read(req.params.id),message=req.body.message;if(typeof message!=='string'||!message.trim()||message.length>3000)throw Error('הודעה לא תקינה');
 if(!p.revisions.length)throw Error('יש לבנות מודול לפני עריכה');
 if(p.revisions.length>=100)throw Error('מגבלת 100 גרסאות לפרויקט');
 const before=p.revisions.at(-1).profile;
 const answer=await askAgent(contract+'\nUpdate the full profile to implement the operator request; keep unrelated settings.\nDATA '+JSON.stringify({profile:before,history:p.messages.slice(-8),catalog:p.catalog.products.slice(0,30)})+'\nOPERATOR REQUEST: '+message);
 const profile=validateProfile(answer.profile);const changes=Object.keys(profile).filter(k=>JSON.stringify(profile[k])!==JSON.stringify(before[k]));
 p.revisions.push({number:p.revisions.length+1,profile,createdAt:new Date().toISOString(),note:message,changes});p.messages.push({role:'user',text:message},{role:'assistant',text:String(answer.message||'נוצרה גרסה חדשה'),changes});p.messages=p.messages.slice(-60);p.status='draft';await persist(p);runtimes.clear();res.json(summary(p));
})));
app.post('/api/projects/:id/rollback',route(async(req,res)=>locked(req.params.id,async()=>{
 const p=await store.read(req.params.id);const r=p.revisions.find(r=>r.number===req.body.revision);if(!r||p.revisions.length>=100)throw Error('גרסה לא תקינה');p.revisions.push({...r,number:p.revisions.length+1,createdAt:new Date().toISOString(),note:'חזרה לגרסה '+r.number});await persist(p);runtimes.clear();res.json(summary(p));
})));
app.post('/api/projects/:id/search',route(async(req,res)=>{if(active>=2)return res.status(429).json({error:'המערכת עסוקה'});active++;try{res.json(await (await runtime(req.params.id)).search(req.body))}finally{active--}}));
app.post('/api/projects/:id/provision',route(async(req,res)=>locked(req.params.id,async()=>{
 const p=await store.read(req.params.id);const result=await provision(p);p.provisioning=result;await persist(p);res.json(result);
})));
app.get('/api/projects/:id/download',route(async(req,res)=>{
 const p=await store.read(req.params.id);res.set('Content-Disposition','attachment; filename="tenant-module.zip"').type('application/zip').send(zipFiles(buildArtifacts(p).files));
}));
app.get('/api/projects/:id/artifacts',route(async(req,res)=>{
 const p=await store.read(req.params.id),r=p.revisions.at(-1);if(!r)throw Error('טרם נוצר מודול');
 res.json(buildArtifacts(p));
}));
app.use(express.static(dir+'public'));
app.use((error,_req,res,_next)=>res.status(400).json({error:error.message}));
export {app};
if(import.meta.url===pathToFileURL(resolve(process.argv[1])).href)app.listen(port,'127.0.0.1',()=>console.log(`Tenant Studio: http://127.0.0.1:${port}`));
