// Read-only, explicitly scoped snapshot. Never imports/starts the production server.
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { mkdir, writeFile } from 'node:fs/promises';
const dbName = 'woo-beautics-shop-co-il';
const out = new URL('../../outputs/beautics-pilot/', import.meta.url);
const client = new MongoClient(process.env.MONGODB_URI, {serverSelectionTimeoutMS:12000});
try {
  await client.connect();
  const projection = Object.fromEntries(['id','name','title','url','image','price','regularPrice','currency','stockStatus','hidden','active','status','categories','tags','colors','specialLabel','fetchedAt','raw.sku'].map(k=>[k,1]));
  const products = await client.db(dbName).collection('products').find({}, {projection:{...projection,_id:0}, maxTimeMS:15000}).limit(10000).toArray();
  if (products.length === 10000) throw new Error('Snapshot limit reached; scope must be reviewed');
  await mkdir(out,{recursive:true});
  await writeFile(new URL('catalog.json',out),JSON.stringify({tenantId:dbName,capturedAt:new Date().toISOString(),products},null,2));
  console.log(`Saved ${products.length} catalog records (allowlisted fields only).`);
} catch (error) {
  console.error(`Snapshot failed: ${error.name}`); process.exitCode=1;
} finally { await client.close(); }
