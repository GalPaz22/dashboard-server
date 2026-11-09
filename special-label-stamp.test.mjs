import test from 'node:test';
import assert from 'node:assert/strict';
import {stampedLabel} from './special-label-stamp.mjs';

const stored=()=>({type:'book_formats',printed:{enabled:true,value:50,badge:'ספר50'},digital:{enabled:true,value:24,sku:'600000062',badge:'₪ 24'},badge:{enabled:true,value:'ספר50'}});

test('a format the store module marked sold out stays off on the fresh stored label, with its offer badge',()=>{
 const previous={...stored(),printed:{enabled:false,soldOut:true,value:49},badge:{enabled:false,value:'ספר50'}};
 const fresh=stored(),out=stampedLabel(previous,fresh);
 assert.equal(out.printed.enabled,false);assert.equal(out.printed.soldOut,true);assert.equal(out.printed.value,50,'prices come from the stored label');
 assert.equal(out.badge.enabled,false);assert.equal(out.digital.enabled,true);assert.equal(fresh.printed.enabled,true,'the cached label is not changed');
 const digitalOff=stampedLabel({digital:{enabled:false,soldOut:true}},stored());
 assert.equal(digitalOff.digital.enabled,false);assert.equal(digitalOff.badge.enabled,true,'the printed offer badge stays');
});

test('anything else is stamped as stored',()=>{
 const s=stored();
 assert.equal(stampedLabel(undefined,s),s);assert.equal(stampedLabel(false,s),s);assert.equal(stampedLabel(stored(),s),s);
 assert.equal(stampedLabel({printed:{soldOut:true}},false),false);assert.equal(stampedLabel({printed:{soldOut:true}},true),true);
});
