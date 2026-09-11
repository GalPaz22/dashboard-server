const $=id=>document.getElementById(id);
let cursor=null, generation=0, timer, suggestGeneration=0;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function link(text,url){const a=node('a',text);a.href=safeUrl(url)||'#';a.target='_blank';a.rel='noopener noreferrer';return a;}
function money(value,currency){if(!Number.isFinite(value))return 'מחיר לא ידוע';try{return new Intl.NumberFormat('he-IL',{style:'currency',currency:currency||'ILS',maximumFractionDigits:2}).format(value);}catch{return String(value);}}
function card(p){
 const article=node('article',undefined,'card');const picture=node('div',undefined,'picture');
 const img=node('img');img.alt=p.title;img.loading='lazy';const src=safeUrl(p.image);if(src)img.src=src;
 img.addEventListener('error',()=>{img.remove();picture.append(node('span','התמונה אינה זמינה','attributes'));},{once:true});picture.append(img);
 const badges=node('div',undefined,'badges');for(const b of p.badges||[])badges.append(node('span',b.text,'badge '+(b.kind==='sale'?'sale':'')));picture.append(badges);
 const body=node('div',undefined,'card-body');body.append(node('h3',p.title));body.append(node('div',[...(p.colors||[]),...(p.finishes||[]).map(f=>f==='glitter'?'מנצנץ':f),p.stockStatus==='instock'?'במלאי בצילום':'לא זמין בצילום'].join(' · '),'attributes'));
 const price=node('div',money(p.price,p.currency),'price');if(Number.isFinite(p.price)&&p.regularPrice>p.price)price.append(node('del',money(p.regularPrice,p.currency)));body.append(price);
 const source=link('למוצר באתר המקורי ↗',p.url);source.className='source';body.append(source);
 const detail=node('details');detail.append(node('summary','מקור הנתונים והתגיות'));
 detail.append(node('p','מזהה: '+p.id));detail.append(node('p','קטגוריות מקור: '+(p.categories||[]).join(' · ')));
 for(const b of p.badges||[]){const line=node('p','באדג׳ שנצפה: '+b.text+' · '+(b.observedAt?new Date(b.observedAt).toLocaleDateString('he-IL'):''));line.append(document.createTextNode(' · '),link('עמוד הראיה',b.sourceUrl));detail.append(line);}
 const pending=(p.badgeCandidates||[]).filter(b=>b.status==='needs-verification');
 if(pending.length)detail.append(node('p','מועמדות לבדיקה, אינן מוצגות כבאדג׳: '+pending.map(b=>b.text).join(' · ')));
 if(p.issues?.length)detail.append(node('p','פערים לבדיקה: '+p.issues.join(' · ')));
 for(const e of p.semanticEvidence||[])detail.append(node('p','התאמה לבקשה: '+e.requirementText+' · ראיה מהקטלוג: '+e.quote));
 body.append(detail);article.append(picture,body);return article;
}
async function run(append=false){
 const current=++generation;++suggestGeneration;clearTimeout(timer);$('suggestions').hidden=true;$('error').hidden=true;$('more').disabled=true;
 if(!append){cursor=null;$('results').replaceChildren();$('count').textContent='מחפש…';$('explanation').textContent='תחילה חיפוש טקסטואלי. אם אין התאמה, החיפוש החכם יבדוק את הקטלוג (עשוי לקחת כמה שניות).';$('more').hidden=true;}
 try{const response=await fetch('/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(append?{cursor}:{query:$('query').value})});if(!response.ok)throw Error('החיפוש נכשל. נסו להתחיל חיפוש מחדש.');const data=await response.json();if(current!==generation)return;
 $('heading').textContent='תוצאות חיפוש';for(const p of data.matches)$('results').append(card(p));cursor=data.nextCursor;$('more').hidden=!cursor;$('count').textContent=`${data.total||0} תוצאות · ${$('results').children.length} מוצגות`;
 const plan=data.plan||{};$('explanation').textContent=[plan.productType==='nail-polish'?'סוג: לק':plan.productType==='nail-drill'?'סוג: מכונת שיוף':'',...(plan.colors||[]),...(plan.finishes||[]).map(()=> 'גימור: מנצנץ'),plan.maxPrice!==null&&plan.maxPrice!==undefined?'מחיר עד '+plan.maxPrice:'',plan.terms?.length?'מילים בשם: '+plan.terms.join(' '):''].filter(Boolean).join(' · ');
 const meta=data.metadata||{};
 $('explanation').textContent=(meta.mode==='llm-lexical'?'פענוח מילולי ב־LLM רזה · חיפוש לפי: '+meta.rewrites.join(' / '):meta.mode==='llm-router'?'נדרשת הבהרה':meta.mode==='llm'?'חיפוש '+(meta.routerRoute==='consultative'?'ייעוצי':'סמנטי')+' באמצעות LLM · '+(meta.intent||'בדיקת התאמה לקטלוג'):meta.mode==='spelling'?'תיקון כתיב לפי הקטלוג: ״'+meta.correction.from+'״ ← ״'+meta.correction.to+'״':'חיפוש טקסטואלי · '+$('explanation').textContent)+(meta.cached?' · תוצאה שמורה':'')+(meta.candidatesTruncated?' · נבדק מדגם מועמדים מוגבל':'');
 if(!data.matches.length&&!append)$('results').append(node('div',data.message||'לא נמצאה התאמה לדרישות. אפשר לשנות את החיפוש; לא נוספו מוצרים שאינם תואמים.','empty'));
 if(data.metadata?.exactMatch===false){const note=node('p','הכרטיסים מסומנים כחלופות כי לא נמצאה התאמה מלאה.');note.className='explanation';$('results').prepend(note);}
 }catch(e){if(current===generation){$('error').hidden=false;$('error').textContent=e.message;$('count').textContent='';}}finally{if(current===generation)$('more').disabled=false;}
}
$('search-form').addEventListener('submit',e=>{e.preventDefault();run();});$('more').addEventListener('click',()=>run(true));
document.querySelectorAll('[data-query]').forEach(b=>b.addEventListener('click',()=>{$('query').value=b.dataset.query;run();}));
const semanticExample=node('button','בקשה חכמה: איסוף אבק בשיוף');semanticExample.type='button';semanticExample.addEventListener('click',()=>{$('query').value='מחפשת משהו שישאב את האבק בזמן שאני משייפת ציפורניים';run();});document.querySelector('.examples').append(semanticExample);
$('query').addEventListener('input',()=>{clearTimeout(timer);const seq=++suggestGeneration;const query=$('query').value;$('suggestions').hidden=true;if(query.trim().length<2)return;timer=setTimeout(async()=>{try{const r=await fetch('/autocomplete?query='+encodeURIComponent(query));if(!r.ok)return;const d=await r.json();if(seq!==suggestGeneration)return;$('suggestions').replaceChildren();for(const s of d.suggestions){const b=node('button',s.label);b.type='button';b.addEventListener('click',()=>{$('query').value=s.id;run();});$('suggestions').append(b);}$('suggestions').hidden=!d.suggestions.length;}catch{}},180);});
$('query').addEventListener('keydown',e=>{if(e.key==='Escape'){$('suggestions').hidden=true;++suggestGeneration;}if(e.key==='ArrowDown'&&!$('suggestions').hidden){e.preventDefault();$('suggestions').querySelector('button')?.focus();}});
$('review').addEventListener('click',async()=>{const current=++generation;++suggestGeneration;clearTimeout(timer);$('suggestions').hidden=true;cursor=null;$('more').hidden=true;$('error').hidden=true;try{const r=await fetch('/review');if(!r.ok)throw Error('לא ניתן לטעון את הבדיקה');const d=await r.json();if(current!==generation)return;$('heading').textContent='כרטיסים עם באדג׳ים שנצפו באתר';$('explanation').textContent='תצוגת בדיקה: כוללת גם מוצרים שאזלו מהמלאי. התצפיות אינן אישור גורף לכללי מבצעים.';$('results').replaceChildren(...d.products.map(card));$('count').textContent=d.products.length+' כרטיסים';}catch(e){if(current===generation){$('error').hidden=false;$('error').textContent=e.message;}}});
run();
if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();
 try{Promise.resolve(document.modelContext.registerTool({
  name:'search_beautics_preview',description:'Search the local Beautics snapshot and update the visible product cards. Does not change the live store.',
  inputSchema:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:300}},required:['query'],additionalProperties:false},
  annotations:{readOnlyHint:false,untrustedContentHint:true},
  async execute(input){if(!input||typeof input.query!=='string'||!input.query.trim()||input.query.length>300||Object.keys(input).some(k=>k!=='query'))throw Error('A query of 1–300 characters is required');$('query').value=input.query;await run();if(!$('error').hidden)throw Error($('error').textContent);return {summary:$('count').textContent,canLoadMore:!!cursor};}
 },{signal:lifecycle.signal})).catch(()=>{});}catch{}
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
