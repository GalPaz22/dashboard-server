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
