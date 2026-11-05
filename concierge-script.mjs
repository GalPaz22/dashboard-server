// Flash-Lite sometimes slips a letter from another alphabet into a Hebrew word: "לקроא", "בمבנה", "המותحן", "סόג" —
// 18 of 183 Steimatzky replies in the first two days. The prompt already forbids it, so the reply is repaired as it
// streams: inside a word that holds Hebrew, a Cyrillic, Arabic or Greek letter becomes the Hebrew letter it stands for
// and any other foreign letter is dropped. A word with no Hebrew in it is a name and stays, unless it is in a script no
// catalog here uses (Thai, CJK, Indic…), which is dropped.

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

export function cleanWord(word) {
  if (!FOREIGN.test(word)) return word;
  if (!HEBREW.test(word)) return NEVER_A_NAME.test(word) ? '' : word;
  return [...word].map(ch => FOREIGN.test(ch) ? (AS_HEBREW[ch.toLowerCase()] ?? '') : ch).join('');
}

export const cleanReplyText = text => String(text).replace(/\S+/g, cleanWord);

// Streaming: a word can arrive split across chunks ("מש" + "вחים"), so the last unfinished word waits for the next
// chunk or for flush().
export function createReplyCleaner() {
  let pending = '';
  return {
    push(chunk) {
      const text = pending + chunk, cut = text.search(/\S*$/);
      pending = text.slice(cut);
      return cleanReplyText(text.slice(0, cut));
    },
    flush() { const rest = cleanReplyText(pending); pending = ''; return rest; },
    reset() { pending = ''; },
  };
}
