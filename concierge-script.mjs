// Flash-Lite sometimes slips a letter or a word from another alphabet into Hebrew: "לקроא", "בمבנה", "המותحן", "סόג",
// "מתאים لما מחפשת" — 18 of 183 Steimatzky replies in the first two days. The prompt already forbids it, so the reply
// is repaired as it streams: a Cyrillic, Arabic or Greek letter becomes the Hebrew letter it stands for, inside a
// Hebrew word or in a short foreign run between Hebrew ones ("להציץ بروايات وخيارات אחרות"). Three foreign words in a
// row or more are a name ("Мир Дедушки и Внучек", an Arabic title) and stay. Scripts no catalog here uses (Thai, CJK, Indic…) are dropped.

const HEBREW = /[א-ת]/;
const FOREIGN = /[Ͱ-Ͽἀ-῿Ѐ-ӿ؀-ۿݐ-ݿऀ-෿฀-໿぀-ヿ㐀-鿿가-힯]/u;
const NEVER_A_NAME = /[ऀ-෿฀-໿぀-ヿ㐀-鿿가-힯]/u;

const AS_HEBREW = {
  // Cyrillic
  а: 'א', б: 'ב', в: 'ו', г: 'ג', д: 'ד', ж: 'ז', з: 'ז', и: 'י', й: 'י', к: 'ק', л: 'ל', м: 'מ', н: 'נ', о: 'ו', п: 'פ',
  р: 'ר', с: 'ס', т: 'ט', у: 'ו', ф: 'פ', х: 'ח', ц: 'צ', ч: 'צ', ш: 'ש', щ: 'ש', ю: 'יו', я: 'יא', ё: 'יו',
  // Arabic
  ا: 'א', أ: 'א', إ: 'א', آ: 'א', ب: 'ב', ت: 'ת', ث: 'ת', ج: 'ג', ح: 'ח', خ: 'ח', د: 'ד', ذ: 'ד', ر: 'ר', ز: 'ז',
  س: 'ס', ش: 'ש', ص: 'צ', ض: 'צ', ط: 'ט', ظ: 'ט', ع: 'ע', غ: 'ע', ف: 'פ', ق: 'ק', ك: 'ק', ل: 'ל', م: 'מ', ن: 'נ',
  ه: 'ה', ة: 'ה', و: 'ו', ؤ: 'ו', ي: 'י', ى: 'י', ئ: 'י',
  // Greek
  α: 'א', ά: 'א', β: 'ב', γ: 'ג', δ: 'ד', ζ: 'ז', θ: 'ת', ι: 'י', ί: 'י', κ: 'ק', λ: 'ל', μ: 'מ', ν: 'נ', ξ: 'קס',
  ο: 'ו', ό: 'ו', π: 'פ', ρ: 'ר', σ: 'ס', ς: 'ס', τ: 'ט', υ: 'ו', ύ: 'ו', φ: 'פ', χ: 'ח', ω: 'ו', ώ: 'ו',
};

const asHebrew = word => [...word].map(ch => FOREIGN.test(ch) ? (AS_HEBREW[ch.toLowerCase()] ?? '') : ch).join('');
const foreignOnly = word => !!word && FOREIGN.test(word) && !HEBREW.test(word);

// around: the two words on each side, so a short foreign run can be told from part of a name.
export function cleanWord(word, [prev2, prev, next, next2] = []) {
  if (!FOREIGN.test(word)) return word;
  if (NEVER_A_NAME.test(word) && !HEBREW.test(word)) return '';
  if (HEBREW.test(word)) return asHebrew(word);
  const inName = (foreignOnly(prev) && (foreignOnly(prev2) || foreignOnly(next))) || (foreignOnly(next) && foreignOnly(next2));
  return inName ? word : asHebrew(word);
}

const split = text => String(text).split(/(\s+)/);

function cleanTokens(tokens, from, to) {
  let out = '';
  for (let i = from; i < to; i++) out += i % 2 ? tokens[i] : cleanWord(tokens[i], [tokens[i - 4], tokens[i - 2], tokens[i + 2], tokens[i + 4]]);
  return out;
}

export const cleanReplyText = text => { const tokens = split(text); return cleanTokens(tokens, 0, tokens.length); };

// Streaming: a word can arrive split across chunks ("מש" + "вחים"), and a word's fate depends on the two words after it,
// so the last three words wait for more text or for flush().
export function createReplyCleaner() {
  let raw = '', sent = 0;
  return {
    push(chunk) {
      raw += chunk;
      // Words sit at even indexes; the last three (indexes length-5, length-3 and length-1) wait.
      const tokens = split(raw), stable = Math.max(sent, tokens.length - 5);
      const out = cleanTokens(tokens, sent, stable);
      sent = stable;
      return out;
    },
    flush() { const tokens = split(raw), out = cleanTokens(tokens, sent, tokens.length); raw = ''; sent = 0; return out; },
  };
}
