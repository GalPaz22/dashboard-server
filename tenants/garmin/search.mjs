import policy from './profile.json' with {type:'json'};
import {processGarmin,garminProfile} from './processor.mjs';
import {processProduct} from '../../search-runtime/core.mjs';
import {createSearchService} from '../../search-runtime/semantic.mjs';
import {generate} from './gemini.mjs';
import {createCatalogLoader} from './catalog.mjs';
import {createSearchSessions} from '../beautics/sessions.mjs';
export function createGarminSearch({loadCatalog=createCatalogLoader(),generator=generate}={}){
 let lastProducts,service;
 return async function searchGarmin({collection,sessions,request}){
  const limit=request.limit??12;if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('Invalid limit');
  if(request.cursor){if(request.query!==undefined)throw Error('Invalid request');if(!sessions)throw Error('Search expired; start a new search');return createSearchSessions(sessions).read(request.cursor,limit);}
  const raw=await loadCatalog(collection);
  if(raw!==lastProducts){
   const profile={...garminProfile(policy,raw),tenantId:'garmin',platform:'woocommerce',sourceUrl:'https://www.garmin.co.il/',version:'garmin-v2',publishedStatuses:['ACTIVE','publish']};
   const products=raw.map(row=>{const mapped=processGarmin(row),p=processProduct(mapped,profile);p.finishes=mapped.garmin.finishes;p.badges=Array.isArray(mapped.badges)?mapped.badges:[];if(mapped.garmin.accessory)p.productType=profile.productTypes.band?.categories.some(c=>p.categories.includes(c))?'band':null;return p;});
   service=createSearchService(products,profile,generator,{...profile.pipeline,maxEntries:10});lastProducts=raw;
  }
  const search=service,result=await search(request);
  return sessions?createSearchSessions(sessions).save(result,search,limit):result;
 };
}
export const searchGarmin=createGarminSearch();
