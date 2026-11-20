import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isStaffToken,issueStaffToken} from './tenants/shipi/staff.mjs';
const {createDraftRuntime}=await import('./tenants/shipi/engine/runtime.mjs');
const SECRET='s'.repeat(32);
const profile={tenantId:'shipi',productTypes:{},queryAliases:{},semanticAliases:{},scopedAliases:[],colors:{},finishes:{},tagDefinitions:{},rankingRules:[],hookData:{},badgeRules:[],badgeCandidates:{},pipeline:{}};
const row=(id,name,stockStatus,price=50)=>({id,name,status:'ACTIVE',stockStatus,categories:[],tags:[],price});
const project=()=>({id:'shipi',url:'https://shipi.co.il/',platform:'woocommerce',catalog:{products:[row('a','כבל טעינה לאייפון','instock'),row('b','כבל טעינה מהיר','outofstock'),row('c','כבל טעינה קצר','instock')]}});

test('staff token: valid, expired, tampered, wrong secret, missing secret',()=>{
 const t=issueStaffToken(SECRET);
 assert.equal(isStaffToken(t,SECRET),true);
 assert.equal(isStaffToken(t.slice(0,-1)+(t.endsWith('0')?'1':'0'),SECRET),false);
 assert.equal(isStaffToken(t,'x'.repeat(32)),false);
 assert.equal(isStaffToken(issueStaffToken(SECRET,-1000),SECRET),false);
 assert.equal(isStaffToken(issueStaffToken(SECRET,48*3600*1000),SECRET),false);
 assert.equal(isStaffToken(t,undefined),false);
 assert.equal(isStaffToken(t,'short'),false);
 assert.equal(isStaffToken(undefined,SECRET),false);
});

test('search: sold-out products only for staff, after the in-stock ones',async()=>{
 const rt=createDraftRuntime(project(),{number:1,profile:{...profile}});
 const shopper=await rt.search({query:'כבל טעינה',limit:20});
 assert.deepEqual(shopper.matches.map(p=>p.id).sort(),['a','c']);
 const staff=await rt.searchStaff({query:'כבל טעינה',limit:20});
 assert.deepEqual(staff.matches.map(p=>p.id).slice(0,2).sort(),['a','c']);
 assert.equal(staff.matches.at(-1).id,'b');
 // the shopper's answer is unchanged after a staff search (no shared cache)
 assert.deepEqual((await rt.search({query:'כבל טעינה',limit:20})).matches.map(p=>p.id).sort(),['a','c']);
});

test('autocomplete: sold-out products only for staff',async()=>{
 const rt=createDraftRuntime(project(),{number:1,profile:{...profile}});
 assert.ok(!(await rt.suggest('כבל טעינה')).matches.some(p=>p.id==='b'));
 assert.ok((await rt.suggest('כבל טעינה',{staff:true})).matches.some(p=>p.id==='b'));
 assert.ok(!(await rt.suggest('כבל טעינה')).matches.some(p=>p.id==='b'));
});

test('a tenant already on "last" is unchanged for staff',async()=>{
 const rt=createDraftRuntime(project(),{number:1,profile:{...profile,pipeline:{outOfStock:'last'}}});
 const a=(await rt.search({query:'כבל טעינה',limit:20})).matches.map(p=>p.id),b=(await rt.searchStaff({query:'כבל טעינה',limit:20})).matches.map(p=>p.id);
 assert.deepEqual(a,b);
});

test('route: only a valid X-Semantix-Staff token reaches the staff search and autocomplete',async()=>{
 process.env.SEMANTIX_STAFF_SECRET=SECRET;
 const {createTenantRoutes,manifest}=await import('./tenants/shipi/index.mjs');
 const seen=[];const search=async({request})=>{seen.push(['s',request.staff]);return {matches:[],total:0,metadata:{}};};
 search.suggest=async({staff})=>{seen.push(['a',staff]);return {matches:[{id:'x',title:'t'}],revision:1};};
 const routes=createTenantRoutes({getDb:async()=>({collection:()=>({})}),search,enabled:()=>true});
 const mkRes=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},json(x){this.body=x;return this;},status(){return this;}});
 const req=(token,extra={})=>({store:{dbName:manifest.dbName,products:'products'},body:{query:'abc',modern:true},query:{query:'abc'},get:h=>h==='X-Semantix-Staff'?token:undefined,...extra});
 for(const [token,want] of [[issueStaffToken(SECRET),true],['bogus',false],[undefined,false]]){
  const r1=mkRes();await routes.search(req(token),r1,()=>{});const r2=mkRes();await routes.autocomplete(req(token),r2,()=>{});
  assert.equal(r1.headers['Cache-Control']==='private, no-store',want);assert.equal(r2.headers['Cache-Control']==='private, no-store',want);
 }
 assert.deepEqual(seen,[['s',true],['a',true],['s',false],['a',false],['s',false],['a',false]]);
});
