import 'dotenv/config';
import { MongoClient } from 'mongodb';
import clientProfile from '../../pilot/beautics/client.json' with {type:'json'};

const dbName = clientProfile.tenantId;
const batchSize = Math.max(25, Number(process.env.ENRICHMENT_BATCH_SIZE || 250));

function badgeCandidates(product) {
  const values = [];
  for (const [field, labels] of Object.entries(clientProfile.badgeCandidates || {})) {
    for (const value of Array.isArray(product[field]) ? product[field] : []) {
      if (labels.includes(value)) values.push({text:value, sourceField:field, status:'needs-verification'});
    }
  }
  return values;
}

function persistedBadges(product) {
  const badges = Array.isArray(product.badges) ? product.badges.filter(b => b && typeof b.text === 'string') : [];
  if (Number.isFinite(product.price) && Number.isFinite(product.regularPrice) && product.regularPrice > product.price && !badges.some(b => b.kind === 'sale')) {
    badges.unshift({kind:'sale', text:'מבצע', order:10, source:'price'});
  }
  return badges.map((badge, index) => ({...badge, order:Number.isFinite(badge.order) ? badge.order : 100 + index, origin:badge.origin || badge.source || 'sync'}));
}

export function buildEnrichmentUpdate(product, now = new Date().toISOString()) {
  return {
    updateOne: {
      filter: {id: product.id},
      update: {$set: {
        badges: persistedBadges(product),
        badgeCandidates: badgeCandidates(product),
        badgeSchemaVersion: 'beautics-v1',
        badgesProcessedAt: now
      }}
    }
  };
}

export async function runBeauticsEnrichment({mongoUri=process.env.MONGODB_URI, dryRun=process.env.ENRICHMENT_DRY_RUN === 'true'} = {}) {
  if (!mongoUri) throw new Error('MONGODB_URI is required');
  const mongo = new MongoClient(mongoUri, {serverSelectionTimeoutMS:15000});
  await mongo.connect();
  try {
    const collection = mongo.db(dbName).collection('products');
    const cursor = collection.find({}, {projection:{id:1,name:1,title:1,categories:1,tags:1,price:1,regularPrice:1,badges:1}}).batchSize(batchSize);
    let batch = [], processed = 0;
    for await (const product of cursor) {
      batch.push(buildEnrichmentUpdate(product));
      if (batch.length >= batchSize) {
        if (!dryRun) await collection.bulkWrite(batch, {ordered:false});
        processed += batch.length; batch = [];
      }
    }
    if (batch.length) { if (!dryRun) await collection.bulkWrite(batch, {ordered:false}); processed += batch.length; }
    return {tenantId:dbName, processed, dryRun, batchSize};
  } finally { await mongo.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBeauticsEnrichment().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode=1; });
}
