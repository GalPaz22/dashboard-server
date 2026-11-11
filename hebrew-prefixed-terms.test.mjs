import test from 'node:test';
import assert from 'node:assert/strict';

// Garmin 11.11: "נשים" returned one product. The catalog writes the word with a prefix ("שעונים חכמים לנשים"), and
// only one product spelled it bare. A word the catalog mostly writes prefixed (ה/ו/ב/ל) is the word itself.
const index=(docs)=>{const terms={};for(const [id,text] of Object.entries(docs))for(const t of new Set(text.split(' ')))(terms[t]??=[]).push(id);return {terms};};
for(const tenant of ['garmin-semantix','carmella','manovino','shipi']){
  const {resolveTerm}=await import(`./tenants/${tenant}/engine/core/search-index.mjs`);
  test(`${tenant}: a word written mostly with a prefix finds the prefixed products`,()=>{
    const r=resolveTerm(index({a:'שעון לנשים',b:'שעון לנשים',c:'שעון נשים',d:'שעון לגברים'}),'נשים');
    assert.deepEqual([...r.postings.keys()].sort(),['a','b','c']);
    assert.equal(r.postings.get('c'),0);assert.equal(r.postings.get('a'),0.5);
  });
  test(`${tenant}: a common bare word keeps its precise results`,()=>{
    const r=resolveTerm(index({a:'אדם',b:'אדם',c:'האדם'}),'אדם');
    assert.deepEqual([...r.postings.keys()].sort(),['a','b']);
  });
  test(`${tenant}: a word with no bare form still reaches the typo fallback, and מ is never a prefix`,()=>{
    const r=resolveTerm(index({a:'בורקס',b:'הבורק'}),'בורק');
    assert.ok(r.postings.has('a'));
    assert.deepEqual([...resolveTerm(index({a:'ספר',b:'מספר',c:'מספר'}),'ספר').postings.keys()],['a']);
  });
}
