import {normalize,authorsOf,sellable} from './core.mjs';

// A query typed with the keyboard in the wrong language: "nv guaho go cghv" is "מה עושים עם בעיה" on a Hebrew layout.
// Only the shape is converted here; the caller accepts the conversion only when the catalog then has a product whose
// title carries every converted word, so valid English (or Hebrew) is never rewritten.
const HE_LAYOUT={q:'/',w:"'",e:'ק',r:'ר',t:'א',y:'ט',u:'ו',i:'ן',o:'ם',p:'פ',a:'ש',s:'ד',d:'ג',f:'כ',g:'ע',h:'י',j:'ח',k:'ל',l:'ך',';':'ף',"'":',',z:'ז',x:'ס',c:'ב',v:'ה',b:'נ',n:'מ',m:'צ',',':'ת','.':'ץ','/':'.'};
const EN_LAYOUT=Object.fromEntries(Object.entries(HE_LAYOUT).filter(([,he])=>/[א-ת]/.test(he)).map(([en,he])=>[he,en]));
export function layoutSwap(query){
 const text=String(query||'').trim().toLowerCase();
 if(/^[a-z,.;' ]+$/.test(text)&&/[a-z]/.test(text))return {to:'he',text:[...text].map(c=>HE_LAYOUT[c]??c).join('').replace(/\s+/g,' ').trim()};
 if(/^[א-ת ]+$/.test(text))return {to:'en',text:[...text].map(c=>EN_LAYOUT[c]??c).join('').replace(/\s+/g,' ').trim()};
 return null;
}

// Author names as the catalog writes them, found from a shopper's spelling of them: a swap of two adjacent letters
// ("אבי חמינז" → אבי חימנז, "Frieda" → Freida), a sound-alike Hebrew letter ("צ'רכי" → צ'רחי), or the same name in the
// other script ("Hanya Yanagihara" → האניה ינגיהארה). Every query word must pair with a word of one name, in any order.
// A near spelling in the same script needs one exact word beside it; a name in the other script must transliterate
// word by word. Names found that are not one person written two ways are ambiguous, and nothing is returned.
const FINAL={ך:'כ',ם:'מ',ן:'נ',ף:'פ',ץ:'צ'},open=w=>w.replace(/[ךםןףץ]/g,c=>FINAL[c]);
const isHebrew=w=>/^[א-ת]+$/.test(w),isLatin=w=>/^[a-z]+$/.test(w);
const SOUND=['כקח','טת','סשצ','בו','אע','אה'];
function nearSpelling(a,b){
 // Inner vowel letters are optional in Hebrew: "דוד" is "דויד" (דויד גרוסמן's Hebrew books), short names included.
 if(a!==b&&a.length>=3&&b.length>=3&&/^[א-ת]+$/.test(a)&&/^[א-ת]+$/.test(b)&&a[0]===b[0]&&a.at(-1)===b.at(-1)&&a.slice(1,-1).replace(/[וי]/g,'')===b.slice(1,-1).replace(/[וי]/g,''))return true;
 if(a.length!==b.length||a.length<4)return a.length>=5&&b.length>=5&&lev1(a,b);
 const diff=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i])diff.push(i);
 if(diff.length===2&&diff[1]===diff[0]+1&&a[diff[0]]===b[diff[1]]&&a[diff[1]]===b[diff[0]])return true;
 if(diff.length===1&&isHebrew(a)&&SOUND.some(s=>s.includes(a[diff[0]])&&s.includes(b[diff[0]])))return true;
 return diff.length===1&&a.length>=5;
}
// One insertion or deletion (substitutions are judged above).
function lev1(a,b){if(Math.abs(a.length-b.length)!==1)return false;const [s,l]=a.length<b.length?[a,b]:[b,a];let i=0;while(i<s.length&&s[i]===l[i])i++;return s.slice(i)===l.slice(i+1);}
// Latin sounds and the Hebrew letters that write them. Vowels (and h, y, w) may be left unwritten; a Hebrew vowel letter
// (א ה ו י ע) may stand for a vowel or be extra.
const TOKENS=['sch','sh','ch','kh','ph','th','tz','ts','zh','ck'];
const LETTERS={sch:'ש',sh:'ש',ch:'חכצש',kh:'חכ',ph:'פב',th:'תט',tz:'צ',ts:'צ',zh:'ז',ck:'קכ',b:'ב',c:'קכסצ',d:'ד',f:'פ',g:'ג',j:'גזי',k:'קכ',l:'ל',m:'מ',n:'נ',p:'פ',q:'ק',r:'ר',s:'סשזצ',t:'טת',v:'בו',x:'קס',z:'זצ',h:'הח',y:'י',w:'וב',a:'אהע',e:'אהיע',i:'יא',o:'ואע',u:'ו'};
const OPTIONAL=new Set(['a','e','i','o','u','h','y','w']),MATRES=new Set([...'אהויע']);
function latinTokens(word){const w=word.replace(/(.)\1+/g,'$1'),out=[];for(let i=0;i<w.length;){const t=TOKENS.find(t=>w.startsWith(t,i))||w[i];out.push(t);i+=t.length;}return out;}
export function transliterates(latin,hebrew){
 const l=latinTokens(latin),h=open(hebrew),memo=new Map();
 const go=(i,j)=>{if(i===l.length&&j===h.length)return true;const key=i*64+j;if(memo.has(key))return memo.get(key);let ok=false;
  if(i<l.length&&j<h.length&&LETTERS[l[i]]?.includes(h[j]))ok=go(i+1,j+1);
  if(!ok&&i<l.length&&OPTIONAL.has(l[i]))ok=go(i+1,j);
  // A Hebrew word never starts with an unwritten vowel before a consonant: "julie" is not ויל (Will).
  if(!ok&&j<h.length&&MATRES.has(h[j])&&!(j===0&&i===0&&!OPTIONAL.has(l[0])))ok=go(i,j+1);
  memo.set(key,ok);return ok;};
 return go(0,0);
}
const consonants=word=>latinTokens(word).filter(t=>!OPTIONAL.has(t)).length;
// How one query word stands for one name word: 'exact', 'near' (same script) or 'script' (the other script), else null.
// Hebrew writes a Latin name in about as many letters or fewer ("mcfadden" מקפדן, "yanagihara" ינגיהארה): a length
// check spares the alignment for almost every name in the catalog.
const scriptPair=(l,h)=>l.length>=3&&h.length<=l.length+2&&h.length*2+2>=l.length&&transliterates(l,h);
function pairKind(q,a){
 if(q===a)return 'exact';
 if(isLatin(q)&&isHebrew(a))return scriptPair(q,a)?'script':null;
 if(isHebrew(q)&&isLatin(a))return scriptPair(a,q)?'script':null;
 return (isLatin(q)&&isLatin(a)||isHebrew(q)&&isHebrew(a))&&nearSpelling(q,a)?'near':null;
}
const PERMS={1:[[0]],2:[[0,1],[1,0]],3:[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]};
export function nameMatch(queryWords,nameWords){
 if(queryWords.length!==nameWords.length||!PERMS[queryWords.length])return null;
 for(const perm of PERMS[queryWords.length]){
  const kinds=queryWords.map((q,i)=>pairKind(q,nameWords[perm[i]]));if(kinds.some(k=>!k))continue;
  if(kinds.every(k=>k==='exact'))return 'exact';
  if(kinds.includes('near')&&!kinds.includes('exact'))continue;
  if(kinds.includes('script')&&kinds.includes('near'))continue;
  if(kinds.includes('script')&&queryWords.filter(isLatin).reduce((n,w)=>n+consonants(w),0)+nameWords.filter(isLatin).reduce((n,w)=>n+consonants(w),0)<4)continue;
  return kinds.includes('script')?'script':'near';
 }
 return null;
}
// A title before the name is not part of it: the catalog's "ד”ר ג’ולי סמית’" is "Dr Julie Smith" and "Julie Smith".
const HONORIFICS=new Set(['דר','dr','דוקטור','doctor','פרופ','פרופסור','prof','professor']);
const personWords=text=>normalize(text).replace(/\./g,' ').split(' ').filter(w=>w&&!HONORIFICS.has(w));
export const personName=text=>personWords(text).join(' ');
export function createAuthorResolver(products,client){
 let names=null;const memo=new Map();
 const build=()=>{names=new Map();for(const p of products){if(p.tenantId!==client.tenantId||!sellable(p,client))continue;
  for(const a of authorsOf(p)){const words=personWords(a);if(words.length<2||words.length>3||words.some(w=>/\d/.test(w)))continue;
   const key=words.join(' ');(names.get(key)||names.set(key,{name:a.trim(),words,ids:[]}).get(key)).ids.push(p.id);}}};
 return query=>{
  const words=personWords(query);
  if(words.length<2||words.length>3||!words.every(w=>isLatin(w)||isHebrew(w))||words.some(w=>w.length<2))return null;
  if(!names)build();
  const key=words.join(' ');if(memo.has(key))return memo.get(key);
  const found=[];for(const n of names.values()){const kind=nameMatch(words,n.words);if(kind)found.push({...n,kind});}
  // Several names must be one person in two scripts or spellings, each pair matching the same way. A name typed right
  // with nothing beside it needs no resolving.
  const result=!found.length||found.length===1&&found[0].kind==='exact'?null:found.some((a,i)=>found.some((b,j)=>j>i&&!nameMatch(a.words,b.words)))?{ambiguous:true,names:found.map(n=>n.name)}
   :{names:found.map(n=>n.name),kind:found.some(n=>n.kind==='exact')?'exact':found[0].kind,ids:[...new Set(found.flatMap(n=>n.ids))]};
  if(memo.size>=500)memo.delete(memo.keys().next().value);memo.set(key,result);return result;
 };
}
