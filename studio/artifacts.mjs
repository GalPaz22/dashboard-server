import {indexDefinition} from './runtime.mjs';
// The browser key below is the existing storefront search key, never an admin token.
export function buildArtifacts(project) {
 const revision=project.revisions.at(-1);if(!revision)throw Error('No revision');
 const widget=`/* Semantix search widget. Configure the deployed search URL and storefront key. */
export function mountSearch(root,{endpoint,apiKey}) {
 const form=document.createElement('form'),input=document.createElement('input'),button=document.createElement('button'),results=document.createElement('div');
 input.placeholder='חיפוש מוצרים'; button.textContent='חפש'; form.append(input,button);root.append(form,results);
 form.onsubmit=async event=>{event.preventDefault();button.disabled=true;results.textContent='מחפש…';
 try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':apiKey},body:JSON.stringify({query:input.value,modern:true,limit:12})});
 if(!response.ok)throw Error('Search unavailable');const data=await response.json();results.replaceChildren();
 for(const p of data.products||data.matches||[]){const card=document.createElement('article'),title=document.createElement('a');title.textContent=p.name||p.title;try{const u=new URL(p.url);if(['https:','http:'].includes(u.protocol))title.href=u.href}catch{}card.append(title);for(const badge of p.badges||[]){const label=document.createElement('span');label.textContent=badge.text;card.append(label)}results.append(card)}
 }catch{results.textContent='החיפוש אינו זמין כרגע. נסו שוב.'}finally{button.disabled=false}};
}
`;
 const files={
  'profile.json':JSON.stringify(revision.profile,null,2),
  'index.json':JSON.stringify(indexDefinition(revision.profile),null,2),
  'product.schema.json':JSON.stringify({type:'object',required:['id','name','stockStatus'],properties:{id:{type:'string'},name:{type:'string'},price:{type:['number','null']},stockStatus:{enum:['instock','outofstock','unknown']},badges:{type:'array',items:{type:'object',required:['text'],properties:{text:{type:'string'},order:{type:'integer'}}}}}},null,2),
  'search.mjs':`// Install under tenants/<tenant>/ in dashboard-server; profile and catalog are versioned inputs.\nimport {createDraftRuntime} from '../../studio/runtime.mjs';\nexport function createTenant(catalog,profile){return createDraftRuntime({id:${JSON.stringify(project.id)},platform:${JSON.stringify(project.platform)},url:${JSON.stringify(project.url)},catalog:{products:catalog}},{number:${revision.number},profile});}\n`,
  'widget.mjs':widget,
  'INSTALL.md':`# ${revision.profile.name}\nDraft revision ${revision.number}.\n\nInstall search.mjs and profile.json under tenants/<tenant>/ in dashboard-server. Register this factory behind authenticated tenant routing before connecting widget.mjs. No live tenant binding has been created.\n\nImport mountSearch from widget.mjs and supply the deployed /search URL and existing storefront API key. Never supply an admin or Studio token. This initial widget renders first-page search and badges; autocomplete/load-more and platform sync installation still need integration.\n\nPlatform: ${project.platform}. Catalog: bounded public sample, not a full synced inventory. Mongo/Atlas provisioning in Studio is staging only.\n`
 };
 if(project.platform==='woocommerce')files['semantix-draft.php']=`<?php
/* Plugin Name: Semantix Tenant Search (Draft)
Description: Search mount shortcode; configure a deployed endpoint and storefront key in wp-config.php.
Version: 0.1.0
*/
if (!defined('ABSPATH')) exit;
add_shortcode('semantix_tenant_search', function() {
 if (!defined('SEMANTIX_SEARCH_URL') || !defined('SEMANTIX_STOREFRONT_KEY')) return '<p>Search configuration required.</p>';
 $id = wp_unique_id('semantix-');
 $config = wp_json_encode(array('endpoint'=>SEMANTIX_SEARCH_URL,'apiKey'=>SEMANTIX_STOREFRONT_KEY), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
 $asset = wp_json_encode(plugins_url('widget.mjs', __FILE__));
 return '<div id="'.esc_attr($id).'"></div><script type="module">import {mountSearch} from '.$asset.';mountSearch(document.getElementById('.wp_json_encode($id).'),'.$config.');</script>';
});
`;
 return {revision:revision.number,platform:project.platform,status:'draft-not-deployed',files};
}
