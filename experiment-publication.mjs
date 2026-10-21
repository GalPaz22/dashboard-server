// Authenticated cache publication only. Definitions and store ownership always
// come from Mongo, never from the request's body, API key or proposed patch.
const key=apiKey=>`experiments:active:${apiKey}`;
export const experimentWire=exp=>({id:String(exp._id),layer:exp.layer,delivery:exp.delivery||'randomized',expiresAt:exp.expiresAt||null,targeting:exp.targeting,trafficPct:exp.trafficPct,arms:exp.arms.map(a=>({key:a.key,weight:a.weight,patch:a.patch||{}}))});
const unavailable=()=>Object.assign(Error('שירות פרסום הניסויים אינו זמין כרגע. לא ניתן לאמת סנכרון.'),{status:503});
export async function readExperimentPublication({store,redis}){
 if(!redis||!store?.apiKey)throw unavailable();
 const raw=await redis.get(key(store.apiKey)),wire=raw?JSON.parse(raw):[];
 if(!Array.isArray(wire))throw unavailable();
 return {available:true,published:true,experimentIds:wire.map(e=>e.id).filter(id=>typeof id==='string'),mode:'search-engine'};
}
export async function publishStoreExperiments({store,client,redis}){
 if(!store?.dbName||!store?.apiKey)throw Object.assign(Error('נדרשת חנות מחוברת'),{status:401});
 if(!redis)throw unavailable();
 const running=await client.db('control_plane').collection('experiments').find({dbName:store.dbName,status:'running'},{projection:{_id:1,layer:1,delivery:1,expiresAt:1,targeting:1,trafficPct:1,arms:1},maxTimeMS:5000}).limit(201).toArray();
 if(running.length>200)throw Object.assign(Error('יותר מדי ניסויים פעילים בחנות'),{status:409});
 const siblings=await client.db('users').collection('users').find({dbName:store.dbName},{projection:{apiKey:1},maxTimeMS:5000}).toArray();
 const keys=[...new Set([store.apiKey,...siblings.map(s=>s.apiKey).filter(k=>typeof k==='string'&&k)])],wire=running.map(experimentWire),payload=JSON.stringify(wire);
 for(const apiKey of keys){if(wire.length)await redis.set(key(apiKey),payload,{EX:120});else await redis.del(key(apiKey));}
 const confirmed=await readExperimentPublication({store,redis});
 const expected=wire.map(e=>e.id).sort();if(JSON.stringify([...confirmed.experimentIds].sort())!==JSON.stringify(expected))throw unavailable();
 return confirmed;
}
export function mountExperimentPublication(app,{getClient,getRedis}){
 const handle=operation=>async(req,res)=>{try{const redis=getRedis();const result=operation==='read'?await readExperimentPublication({store:req.store,redis}):await publishStoreExperiments({store:req.store,client:await getClient(),redis});res.set('cache-control','no-store').json(result);}catch(e){res.status(e.status||503).json({error:e.status===401?e.message:'שירות פרסום הניסויים אינו זמין כרגע. יש לנסות שוב.'});}};
 app.get('/experiments/publication',handle('read'));
 app.post('/experiments/publication',handle('publish'));
}
