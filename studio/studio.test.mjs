import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {createStore} from './store.mjs';import {publicAddress} from './discover.mjs';import {validateProfile} from './model.mjs';import {createDraftRuntime} from './runtime.mjs';
const profile={name:'Store',domain:'books',productTypes:{},colors:{},finishes:{},queryAliases:{ביס:'בייס'},badgeCandidates:{categories:[],tags:[]},badgeRules:[],pipeline:{maxCandidates:20,lightweightRouter:true}};
test('discovery blocks internal networks',()=>{for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.20.0.2','192.168.0.5','100.64.0.1','::1'])assert.equal(publicAddress(ip),false);assert.equal(publicAddress('8.8.8.8'),true)});
test('profile cannot request unbounded candidate work or malformed rules',()=>{assert.equal(validateProfile(profile),profile);assert.throws(()=>validateProfile({...profile,pipeline:{maxCandidates:10000,lightweightRouter:true}}));assert.throws(()=>validateProfile({...profile,badgeRules:[{field:'arbitrary',text:'hi'}]}))});
test('versioned projects survive reload and cannot escape store',async()=>{const root=await mkdtemp(tmpdir()+'/studio-');try{const store=createStore(root),p={id:randomUUID(),name:'A',revisions:[{number:1}],updatedAt:new Date().toISOString()};await store.save(p);assert.deepEqual(await createStore(root).read(p.id),p);assert.equal((await store.list()).length,1);await assert.rejects(store.read('../secret'))}finally{await rm(root,{recursive:true})}});
test('chat policy revisions change actual runtime results, badges require explicit rule',async()=>{const project={id:'tenant',platform:'custom',url:'https://example.com',catalog:{products:[{id:'1',name:'בייס שקוף',status:'ACTIVE',stockStatus:'instock',categories:['קמפיין'],tags:[],price:20}]}};const draft=createDraftRuntime(project,{number:2,profile:{...profile,badgeRules:[{field:'categories',value:'קמפיין',text:'חדש',order:10}]}});const result=await draft.search({query:'ביס'});assert.equal(result.matches[0].title,'בייס שקוף');assert.equal(result.matches[0].badges[0].text,'חדש');assert.equal(result.metadata.llmUsed,false);assert.equal(draft.profile.domain,'books')});
import {buildArtifacts} from './artifacts.mjs';import {zipFiles} from './zip.mjs';
test('export includes installable WooCommerce wrapper and a nonempty ZIP',()=>{
 const artifact=buildArtifacts({id:'abc',url:'https://example.com',platform:'woocommerce',revisions:[{number:1,profile}]});
 assert.match(artifact.files['semantix-draft.php'],/Plugin Name/);assert.match(artifact.files['search.mjs'],/createDraftRuntime/);
 const zip=zipFiles(artifact.files);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
 assert.throws(()=>zipFiles({'../secret':'bad'}));
});
