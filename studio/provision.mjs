import {MongoClient} from 'mongodb';
import {createDraftRuntime,indexDefinition} from './runtime.mjs';
export async function provision(project) {
 if(!process.env.MONGODB_URI)throw Error('נדרש MONGODB_URI');
 if(!project.catalog?.products?.length)throw Error('אין קטלוג לייבוא');
 const mongo=new MongoClient(process.env.MONGODB_URI,{maxPoolSize:2,serverSelectionTimeoutMS:10000});
 const dbName='studio_'+project.id.replaceAll('-','');
 try {
  await mongo.connect();const db=mongo.db(dbName),collection=db.collection('products');
  await collection.createIndex({id:1},{unique:true});
  await collection.createIndex({stockStatus:1,price:1});
  const normalized=createDraftRuntime(project,project.revisions.at(-1)).products;
  for(let start=0;start<normalized.length;start+=100){
   const writes=normalized.slice(start,start+100).map(p=>({updateOne:{filter:{id:p.id},update:{$set:{...p,name:p.title,studioProject:project.id}},upsert:true}}));await collection.bulkWrite(writes,{ordered:false});
  }
  let atlas='not-created';
  try {const definition=indexDefinition(project.revisions.at(-1).profile);const existing=await collection.listSearchIndexes(definition.name).toArray();if(!existing.length)await collection.createSearchIndex(definition);else await collection.updateSearchIndex(definition.name,definition.definition);atlas='requested-check-atlas-readiness'}catch{atlas='requires-atlas-search-permission-or-supported-cluster'}
  return {dbName,products:project.catalog.products.length,atlas,message:`נוצרה סביבת בדיקה ${dbName}, עם ${project.catalog.products.length} מוצרים. סטטוס Atlas: ${atlas}. חיפוש התצוגה עדיין משתמש במנוע המקומי; האינדקס אינו מופעל בפרודקשן.`};
 }finally{await mongo.close()}
}
