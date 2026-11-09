import test from 'node:test';
import assert from 'node:assert/strict';
import {looksLikeGarminSku} from './concierge.mjs';
import {decideTrigger} from '../../concierge.mjs';

test('part numbers are recognised; model names and plain numbers are not',()=>{
  for(const q of ['010-04337-41H','010-03199-40H','010-02980-03',' 010-04337-41h ','020-00336-00H'])assert.equal(looksLikeGarminSku(q),true,q);
  for(const q of ['Forerunner 970','RS210','HRM-600','Fenix-8','255','Garmin Forerunner 970','010 04337 41H','שעון'])assert.equal(looksLikeGarminSku(q),false,q);
});

test('a Garmin part number never opens the concierge, even with nothing found; other stores are unaffected',async()=>{
  assert.equal(await decideTrigger({payload:[],query:'010-04337-41H',store:{dbName:'garmin'},ctx:{}}),null);
  assert.equal((await decideTrigger({payload:[],query:'010-04337-41H',store:{dbName:'other'},ctx:{}}))?.reason,'no_results');
  assert.equal((await decideTrigger({payload:[],query:'Forerunner 970',store:{dbName:'garmin'},ctx:{}}))?.reason,'no_results');
});

test('the concierge only offers products a shopper can open and buy',async()=>{
  const {offeredToShoppers}=await import('../../concierge.mjs');
  const base={id:'1',name:'Instinct 3',price:1699,status:'publish',catalog_visibility:'visible',stockStatus:'instock'};
  assert.equal(offeredToShoppers(base),true);
  assert.equal(offeredToShoppers({id:'2',name:'no Woo fields',price:99}),true);
  assert.equal(offeredToShoppers({id:'3',name:'no price field'}),true);
  for(const p of [{...base,status:'private'},{...base,status:'DRAFT'},{...base,catalog_visibility:'hidden'},{...base,price:0},{...base,price:'0'},{...base,hidden:true},null])
    assert.equal(offeredToShoppers(p),false,JSON.stringify(p));
});

test('Garmin instructions carry the square watch, same-kind alternatives and service questions; other stores get none',async()=>{
  const {garminConciergeInstructions}=await import('./concierge.mjs');
  const text=garminConciergeInstructions({dbName:'garmin'});
  for(const must of ['Venu X1','שעון במקום שעון','BuyMe','Titanium'])assert.ok(text.includes(must),must);
  assert.equal(garminConciergeInstructions({dbName:'steimatzky'}),'');
});
