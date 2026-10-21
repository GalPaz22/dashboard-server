import 'dotenv/config';
import {readFileSync} from 'node:fs';
import {MongoClient} from 'mongodb';
import {createTenantSearch,createRowLoader} from './tenants/steimatzky/search.mjs';
const c=new MongoClient(process.env.MONGODB_URI);await c.connect();const db=c.db('steimatzky');
const products=db.collection('products'),store=db.collection('semantix_module'),rows=await createRowLoader()(products);
const search=createTenantSearch({loadRows:async()=>rows});
const sample=JSON.parse(readFileSync(process.argv[2],'utf8'));const b={top12:0,later:0,absent:0};
for(const r of sample){const x=await search({collection:products,moduleStore:store,request:{query:r.q,limit:50}});
 const pos=x.matches.map(m=>String(m.id).split(':').pop()).indexOf(String(r.id).split(':').pop());b[pos<0?'absent':pos<12?'top12':'later']++;if(pos<0||pos>=12)console.log('MISS',pos,r.q);}
console.log(JSON.stringify(b));
for(const q of ['האמת','צלקות']){const x=await search({collection:products,moduleStore:store,request:{query:q,limit:3}});console.log(q,'→',x.matches.map(m=>m.stockStatus[0]+':'+m.title).join(' | '));}
await c.close();process.exit(0);
