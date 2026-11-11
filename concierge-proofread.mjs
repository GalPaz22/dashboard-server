// A second look at the concierge's finished reply. Flash-Lite now and then writes a Hebrew word that does not exist
// ("תרדיף", "בששלגוחי", "לשמשעון"), glues Latin letters into a Hebrew word ("תרzi"), or switches language for a whole
// sentence (Arabic): 29 of 440 Garmin replies, 5–9.11.2026. The streaming cleaner (concierge-script.mjs) maps stray
// letters; it cannot know a word is not Hebrew. The proofreader names only the broken words and their fixes, and only
// those words are replaced, so the rest of the reply cannot be rewritten. Two readings run side by side. Letters from
// another alphabet are visible on their own, so either reading may fix them; a Hebrew word said not to exist is fixed
// only when both readings name it, since one reading now and then flags a correct word ("שעות" → "עונות"). A timeout or
// an error keeps the reply.
import {cleanReplyText} from './concierge-script.mjs';

const FOREIGN = /[\u1200-\u137FͰ-ϿЀ-ӿ؀-ۿݐ-ݿऀ-෿฀-໿぀-ヿ㐀-鿿가-힯]/;
const MAX_FIXES = 8;

export const PROOFREAD_PROMPT = `אתה מגיה עברית. תקבל תשובה של עוזר מכירות בחנות. מצא בה רק את הפגמים האלה:
- מילה שלא קיימת בעברית (אותיות משובשות, כפולות, חסרות, או מילים שהתמזגו);
- אותיות מאלפבית אחר בתוך מילה עברית (למשל לטינית צמודה למילה עברית);
- מילים או משפט בשפה שאינה עברית ואינה שם של מוצר (ערבית, רוסית, יוונית).
שמות מוצרים, מותגים ודגמים באותיות לטיניות (Garmin, Forerunner, fēnix, AMOLED, mm), מספרים, מחירים, ניסוח וסגנון אינם פגמים.
לכל פגם כתוב שורה אחת: הטקסט השגוי בדיוק כפי שהוא מופיע, אחריו => ואחריו התיקון בעברית. אם אינך בטוח מה המילה הנכונה, אל תכתוב את השורה.
אם אין פגמים, כתוב רק: תקין`;

const LETTER = '[\\p{L}\\p{M}\\p{N}]';
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The wrong text as whole words: "שוני" must not rewrite the "שוני" inside "לשוני".
const wholeWords = wrong => new RegExp(`(?<!${LETTER})${escape(wrong)}(?!${LETTER})`, 'gu');

const digits = text => (String(text).match(/\d+/g) || []).join(' ');

// "שגוי => תיקון" lines, kept only when the wrong text is really in the reply and the fix is plain Hebrew with the
// same numbers; a foreign-language phrase may come back as a longer Hebrew one, a Hebrew word as one to three words.
export function parseFixes(raw, original, protectedText = '') {
  const fixes = [];
  for (const line of String(raw || '').split('\n')) {
    const match = line.match(/^\s*[-*•]?\s*(.+?)\s*=>\s*(.*?)\s*$/);
    if (!match) continue;
    const [, wrong, right] = match;
    if (!wrong || !right || wrong === right || !wholeWords(wrong).test(original) || wholeWords(wrong).test(protectedText)) continue;
    if (FOREIGN.test(right) || /[A-Za-z()]/.test(right) || /תקין/.test(right) || digits(right) !== digits(wrong)) continue;
    // A Latin word standing on its own is a product name (fēnix, AMOLED); only Latin glued to Hebrew is a defect.
    if (/[A-Za-z]/.test(wrong) && !/[א-ת]/.test(wrong) && !FOREIGN.test(wrong)) continue;
    if (!FOREIGN.test(wrong) && right.split(/\s+/).filter(Boolean).length > 3) continue;
    fixes.push([wrong, right]);
    if (fixes.length >= MAX_FIXES) break;
  }
  return fixes;
}

export function applyFixes(text, fixes) {
  let out = text;
  for (const [wrong, right] of fixes) out = out.replace(wholeWords(wrong), right).replace(/ {2,}/g, ' ');
  return cleanReplyText(out);
}

export async function proofreadReply(text, {generate, timeoutMs = 2500, protectedText = ''}) {
  const original = String(text || '');
  if (original.trim().length < 2) return {text: original, changed: false};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const [first, second] = await Promise.all([0, 1].map(() => generate(original, controller.signal)));
    const a = parseFixes(first, original, protectedText), b = parseFixes(second, original, protectedText);
    const named = new Set(b.map(([wrong]) => wrong));
    const visible = ([wrong]) => FOREIGN.test(wrong) || /[A-Za-z]/.test(wrong) && /[א-ת]/.test(wrong);
    const fixes = [...a.filter(fix => visible(fix) || named.has(fix[0])), ...b.filter(fix => visible(fix) && !a.some(([wrong]) => wrong === fix[0]))];
    if (!fixes.length) return {text: original, changed: false};
    const corrected = applyFixes(original, fixes);
    return corrected === original ? {text: original, changed: false} : {text: corrected, changed: true, fixes};
  } catch (err) {
    return {text: original, changed: false, error: controller.signal.aborted ? 'timeout' : err.message};
  } finally {
    clearTimeout(timer);
  }
}
