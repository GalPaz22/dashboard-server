import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storefrontResponse} from './response.mjs';
test('existing storefront receives products/name and badges in modern and legacy modes',()=>{
 const result={matches:[{id:'p',title:'Strong',badges:[{text:'מבצע'}]}],total:1,nextCursor:null,metadata:{phase:'lexical'}};
 const modern=storefrontResponse(result,true);
 assert.equal(modern.products[0].name,'Strong');assert.deepEqual(modern.products[0].badges,result.matches[0].badges);
 assert.equal(modern.metadata.searchEngine,'beautics-v2');assert.equal(modern.pagination.hasMore,false);
 assert.deepEqual(storefrontResponse(result,false),modern.products);
});
