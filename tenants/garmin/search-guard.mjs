// Searches the engine answered with unrelated products (26.11.2026): "רצועות לשעון Venus 4" opened with whole watches
// after 7.75 s, "טרייד אין" showed a trainer axle, unknown part numbers showed heart-rate straps. These three kinds are
// decided here from the catalog, without a model call; everything else goes to the engine as before.
import { normalize, sellable } from '../garmin-semantix/engine/core/core.mjs';
import { looksLikeGarminSku, looksLikeGarminServiceQuery } from './concierge.mjs';

const answer = (phase, matches, message = null) => ({
  status: matches.length ? 'matched' : 'empty', matches, total: matches.length, nextCursor: null,
  message: matches.length ? null : message,
  metadata: { mode: 'text', phase, exactMatch: matches.length > 0, fullMatch: matches.length > 0, llmUsed: false, llmCalls: 0 },
});
const inStockFirst = (list) => [...list.filter((p) => p.stockStatus === 'instock'), ...list.filter((p) => p.stockStatus !== 'instock')];

/* ------------------------------------------------------------------ part numbers */

const code = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// "010-02752-08H" and "0100275208" are the same part: the trailing region letters are dropped.
const base = (value) => code(value).replace(/[A-Z]{1,2}$/, '');
export const isPartNumber = (query) => looksLikeGarminSku(query) || /^010\d{5,9}[A-Z]{0,2}$/i.test(String(query || '').trim());
export function findByPartNumber(query, products) {
  const wanted = base(query);
  return products.filter((p) => p.sku && (base(p.sku) === wanted || (wanted.length >= 8 && code(p.sku).startsWith(wanted))));
}

const OWN_SERIES = /^(venu|fenix|fr|edge|epix|marq|lily|tacx|hrm|rally|index|varia|etrex|dash|zumo|gpsmap)-/i;
// A maker's code the catalog does not have ("XS-F40CWB"): the model matched its letters to XS-S heart-rate straps.
export const isForeignCode = (query) => {
  const text = String(query || '').trim().replace(/[\u2010-\u2015]/g, '-');
  return text.length >= 8 && /^[a-z]{1,5}-[a-z0-9-]*\d{2}[a-z0-9-]*$/i.test(text) && !OWN_SERIES.test(text);
};

/* ------------------------------------------------------------------ watch bands */

const BAND_WORD = /^ו?(רצועה|רצועות|רצועת|strap|straps|band|bands)$/;
const SYSTEM_WORDS = { quickfit: 'quickfit', ultrafit: 'ultrafit', quickrelease: 'quickrelease' };
// Other things that are called a strap, or a request for a watch that comes with one.
const NOT_WATCH_BAND = /דופק|חזה|hrm|שינה|index|אינדקס|cirqa|סירקה|bundle|באנדל|mount|מתקן|תושבת|זרוע|מטען|טעינה|charg|cable|כבל|צמיד|vivosmart|מגן|screen|(^| )(עם|with)( |$)|^(שעון|watch) (?!band|strap)/;
const WIDTHS = new Set([14, 18, 20, 22, 24, 26]);
const FAMILIES = {
  venu: /^(venu|venus|venue|vanue|וניו|ווניו)$/,
  forerunner: /^(forerunner|forunner|forrunner|forner|fr|פוראנר|פורראנר|פוררנר|פורנר|פורארנר)$/,
  fenix: /^(fenix|פניקס|פיניקס|פנקס|פינקס|פלקס)$/,
  vivoactive: /^(vivoactive|vivoactiv|אקטיב|ויוואקטיב|ויואקטיב|וויוואקטיב|וויואקטיב)$/,
  instinct: /^(instinct|אינסטינקט|אינסטיקט|אינסטנקט|אינסטנט)$/,
  enduro: /^(enduro|אנדורו)$/, epix: /^(epix|אפיקס)$/, marq: /^(marq|מארק|מרק)$/, tactix: /^(tactix|טקטיקס)$/,
  quatix: /^(quatix|קוואטיקס|קואטיקס)$/, lily: /^(lily|לילי)$/, approach: /^(approach|אפרוץ)$/, descent: /^(descent|דיסנט)$/,
};
const familyOf = (word) => Object.keys(FAMILIES).find((f) => FAMILIES[f].test(word)) || null;
const GENERIC = /^(garmin|גארמין|גרמין|גרמן|שעון|שעוני|שעונים|לשעון|לשעוני|לשעונים|של|ל|עבור|להחלפה|החלפה|חלופית|חלופיות|חלופי|חלופה|נוספת|watch|for|replacement|spare|original|מקורית|מקורי|סדרת|לסדרת|pro|פרו|sapphire|ספיר|solar|סולר|סולאר|amoled|music|mm|ממ|מ|רוחב|ברוחב|בצבע|צבע)$/;
const MATERIALS = [
  { words: /^(titanium|metal|bracelet|טיטניום|טיטאניום|מתכת|מתכתית)$/, title: /titanium|bracelet|טיטניום|מתכת/i },
  { words: /^(leather|עור|מעור)$/, title: /leather|עור/i },
  { words: /^(nylon|fabric|ניילון|בד|אריג)$/, title: /nylon|ultrafit|jacquard|ניילון/i },
  { words: /^(silicone|סיליקון)$/, title: /silicone|סיליקון/i },
];
const COLOURS = [
  ['black', 'שחור|שחורה'], ['white', 'לבן|לבנה'], ['red', 'אדום|אדומה'], ['blue', 'כחול|כחולה|תכלת'], ['green', 'ירוק|ירוקה'],
  ['gr[ae]y', 'אפור|אפורה'], ['yellow', 'צהוב|צהובה'], ['orange', 'כתום|כתומה'], ['pink', 'ורוד|ורודה'], ['purple|orchid', 'סגול|סגולה'],
  ['brown|chestnut', 'חום|חומה'], ['mint|spearmint', 'מנטה'], ['moss|olive', 'זית'], ['navy', 'נייבי'], ['gold', 'זהב'],
  ['citron', 'citron'], ['graphite', 'גרפיט'], ['amp', 'amp'], ['cyan', 'cyan'], ['coyote', 'coyote'], ['tan', 'tan'],
].map(([en, he]) => ({ words: new RegExp(`^(${en}|${he})$`), title: new RegExp(`${en}|${he}`, 'i') }));

const prepare = (query) => normalize(query).replace(/[|./+_*#]/g, ' ')
  .replace(/quick ?fit/g, 'quickfit').replace(/ultra ?fit/g, 'ultrafit').replace(/quick ?release/g, 'quickrelease')
  .replace(/vivo ?activ(e)?/g, 'vivoactive').replace(/(^| )ויוו אקטיב( |$)/g, '$1vivoactive$2')
  .replace(/(venu|venus|fenix|forerunner|instinct|vivoactive|enduro|lily|quatix|tactix|quickfit|ultrafit|וניו|פניקס|פיניקס)(?=\d)/g, '$1 ')
  .replace(/(\d)(?=mm|ממ)/g, '$1 ').replace(/\s+/g, ' ').trim();

/** What a band search asks for, or null when it is not a replacement-band search. */
export function parseBandQuery(query) {
  const text = prepare(query);
  if (!text || NOT_WATCH_BAND.test(text)) return null;
  const words = text.split(' ');
  const asks = words.some((w) => BAND_WORD.test(w) || SYSTEM_WORDS[w]) || /(^| )(14|18|20|22|24|26) (mm|ממ)( |$)/.test(text);
  if (!asks) return null;
  const wanted = { family: null, model: null, size: null, width: null, system: null, material: null, colours: [], unknown: [] };
  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    if (BAND_WORD.test(word)) continue;
    if (SYSTEM_WORDS[word]) { wanted.system = SYSTEM_WORDS[word]; continue; }
    // "לפניקס": the Hebrew "to" glued to the series name.
    if (word.startsWith('ל') && familyOf(word.slice(1))) word = word.slice(1);
    const family = familyOf(word);
    if (family) { wanted.family = family; continue; }
    const number = word.match(/^(\d{1,3})(s|x)?$/);
    if (number) {
      const value = Number(number[1]);
      const unit = /^(mm|ממ)$/.test(words[i + 1] || '') || /^(מ|מילימטר)$/.test(words[i + 1] || '');
      const afterSystem = !!SYSTEM_WORDS[words[i - 1]] || /^(רוחב|ברוחב)$/.test(words[i - 1] || '');
      if (!number[2] && WIDTHS.has(value) && (unit || afterSystem || !wanted.family)) wanted.width = value;
      else if (!number[2] && value >= 38 && value <= 51 && (unit || wanted.family === 'fenix' || wanted.model)) wanted.size = value;
      else if (wanted.family && !wanted.model) wanted.model = word;
      else if (!wanted.family && /^[5-8]x$/.test(word)) { wanted.family = 'fenix'; wanted.model = word; }
      else wanted.unknown.push(word);
      continue;
    }
    if (wanted.family && !wanted.model && /^(sq|x1|e|plus)$/.test(word)) { wanted.model = word; continue; }
    const material = MATERIALS.find((m) => m.words.test(word));
    if (material) { wanted.material = material; continue; }
    const colour = COLOURS.find((c) => c.words.test(word));
    if (colour) { wanted.colours.push(colour); continue; }
    if (GENERIC.test(word)) continue;
    wanted.unknown.push(word);
  }
  return wanted;
}

// Which bands a watch takes, as [system, width]. Sources: the compatibility lists on the store's own band products
// and, for Venu 4 (listed on none of them), Garmin's spec pages. A model that is not here is not guessed.
const QR = (w) => ['quickrelease', w], QF = (w) => ['quickfit', w], LILY = ['lily', 14];
export function bandsFor({ family, model, size }) {
  const m = model || '';
  switch (family) {
    case 'venu':
      if (!m) return [QR(18), QR(20), QR(22)];
      if (m === '4') return size === 41 ? [QR(18)] : size === 45 ? [QR(22)] : [QR(18), QR(22)];
      if (m === '3s' || (m === '3' && size === 41)) return [QR(18)];
      if (m === '3') return [QR(22)];
      if (m === '2s') return [QR(18)];
      if (m === 'sq' || m === 'plus') return [QR(20)];
      return null;
    case 'vivoactive':
      if (!m) return [QR(18), QR(20), QR(22)];
      if (m === '4s') return [QR(18)];
      if (m === '4') return [QR(22)];
      return ['3', '5', '6'].includes(m) ? [QR(20)] : null;
    case 'forerunner':
      if (!m) return [QR(18), QR(20), QR(22), QF(22)];
      if (['55', '165', '245', '645'].includes(m)) return [QR(20)];
      if (['255s', '265s'].includes(m)) return [QR(18)];
      if (['255', '265'].includes(m)) return [QR(22)];
      if (['955', '965'].includes(m)) return [QR(22), QF(22)];
      return ['745', '935', '945'].includes(m) ? [QF(22)] : null;
    case 'fenix':
      if (/^[5-8]x$/.test(m) || size === 51) return [QF(26)];
      if (size === 47 || m === 'e') return [QF(22)];
      if (!m) return size ? null : [QF(22), QF(26)];
      if (['5', '6', '7'].includes(m)) return size ? null : [QF(22)];
      return m === '8' && !size ? [QF(22), QF(26)] : null;
    case 'enduro': return ['', '2', '3'].includes(m) ? [QF(26)] : null;
    case 'instinct':
      if (m === '2x') return [QF(26)];
      return ['', '2'].includes(m) ? [QF(22)] : null;
    case 'tactix': return ['', '7'].includes(m) ? [QF(26)] : null;
    case 'quatix':
      if (['6x', '7x'].includes(m)) return [QF(26)];
      return ['', '5', '6', '7'].includes(m) ? [QF(22)] : null;
    case 'epix': return [QF(22), QF(26)];
    case 'marq': return [QF(22)];
    case 'lily': return m ? null : [LILY];
    case 'approach':
      if (['s60', 's62', 's70'].includes(m)) return [QF(22)];
      return null;
    case 'descent': return m ? null : [QF(22), QF(26)];
    default: return null;
  }
}

export const isWatchBand = (p) => (p.categories || []).some((c) => /רצועות לשעון|^quickfit \d/i.test(c)) && !/דופק|hrm|index|cirqa/i.test(p.title);
export function bandSpec(title) {
  const t = String(title || '').replace(/[®™]/g, '');
  const system = /ultrafit/i.test(t) ? 'quickfit' : /quick release/i.test(t) ? 'quickrelease' : /lily/i.test(t) ? 'lily'
    : /quickfit|fenix 5\/6\/7/i.test(t) ? 'quickfit' : null;
  const width = t.match(/(?<!\d)(14|18|20|22|24|26)\s*(?:mm|מ["״]מ)/i) || t.match(/quickfit\s*(14|18|20|22|24|26)/i);
  return { system, width: width ? Number(width[1]) : null, ultrafit: /ultrafit/i.test(t) };
}

const label = (w) => [w.family && w.family[0].toUpperCase() + w.family.slice(1), w.model?.toUpperCase(), w.size && `${w.size} מ"מ`].filter(Boolean).join(' ');

function bandAnswer(wanted, bands) {
  // A series or width the table can decide. null = this model's band is unknown here.
  const fits = wanted.family ? bandsFor(wanted) : undefined;
  if (fits === null && !wanted.width) return null;
  let list = bands.filter((p) => {
    const spec = bandSpec(p.title);
    if (wanted.width && spec.width !== wanted.width) return false;
    if (wanted.system === 'ultrafit' ? !spec.ultrafit : wanted.system && spec.system !== wanted.system) return false;
    return !fits || fits.some(([system, width]) => spec.system === system && spec.width === width);
  });
  if (!list.length) {
    const what = [label(wanted), wanted.system && { quickfit: 'QuickFit', ultrafit: 'UltraFit', quickrelease: 'Quick Release' }[wanted.system], wanted.width && `${wanted.width} מ"מ`].filter(Boolean).join(' ');
    return answer('band-guide', [], `לא נמצאה באתר רצועה מתאימה ל-${what}.`);
  }
  if (wanted.material) { const only = list.filter((p) => wanted.material.title.test(p.title)); if (only.length) list = only; }
  const wantedColour = (p) => (wanted.colours.some((c) => c.title.test(p.title)) ? 1 : 0);
  list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  // The first page shows every width and system that fits, not 24 colours of one of them.
  const mixed = (items) => {
    const groups = new Map();
    for (const p of items) { const s = bandSpec(p.title), key = `${s.system} ${s.width} ${s.ultrafit}`; (groups.get(key) || groups.set(key, []).get(key)).push(p); }
    const lists = [...groups.values()], out = [];
    for (let i = 0; out.length < items.length; i++) for (const group of lists) if (group[i]) out.push(group[i]);
    return out;
  };
  const inStock = list.filter((p) => p.stockStatus === 'instock'), soldOut = list.filter((p) => p.stockStatus !== 'instock');
  // In stock before sold out; inside each, the colour asked for first.
  return answer('band-guide', [inStock, soldOut].flatMap((part) => [...mixed(part.filter(wantedColour)), ...mixed(part.filter((p) => !wantedColour(p)))]));
}

/* ------------------------------------------------------------------ heart-rate straps */

// "רצועת דופק" also matched watches sold "with a silicone strap" and trainer bundles that include a strap.
const HEART_STRAP_QUERY = /^(רצועה|רצועת|רצועות)( ניטור| מד)? (דופק|חזה)( |$)/;
export const isHeartStrap = (p) => (p.categories || []).some((c) => /רצועות דופק/.test(c)) || /^(רצועת דופק|hrm)/i.test(String(p.title || '').trim());

/* ------------------------------------------------------------------ the guard */

/**
 * engine() runs the module's search and resolves to its result with every match; products are the module's catalog.
 */
export async function guardGarminSearch({ query, products, profile, engine }) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300 || !Array.isArray(products)) return engine();
  const visible = products.filter((p) => sellable(p, profile));
  const typed = normalize(query);
  // A product's own title (autocomplete pick, a name pasted from the site) is the engine's title match.
  if (visible.some((p) => normalize(p.title) === typed)) return engine();
  // A title that carries every word typed: the shopper may well mean that product ("מעמד תיקון" is not a repair request).
  const words = typed.split(' ').filter(Boolean);
  const named = () => visible.some((p) => { const title = normalize(p.title); return words.every((w) => title.includes(w)); });

  if (isPartNumber(query)) {
    const found = findByPartNumber(query, visible);
    if (found.length) return answer('part-number', inStockFirst(found));
    return named() ? engine() : answer('part-number', [], 'לא נמצא באתר מוצר עם המק"ט הזה.');
  }
  if (isForeignCode(query)) {
    const found = findByPartNumber(query, visible);
    if (found.length) return answer('part-number', inStockFirst(found));
    return named() ? engine() : answer('part-number', [], 'לא נמצא באתר מוצר עם המק"ט הזה.');
  }
  if (looksLikeGarminServiceQuery(query) && !named()) {
    return answer('service-query', [], 'זו שאלת שירות. כדאי לפנות לשירות הלקוחות של גארמין ישראל.');
  }
  if (HEART_STRAP_QUERY.test(typed)) {
    const result = await engine(), straps = result.matches.filter(isHeartStrap);
    return straps.length ? { ...result, matches: straps, total: straps.length } : result;
  }
  const wanted = parseBandQuery(query);
  if (!wanted) return engine();
  const bands = visible.filter(isWatchBand);
  if (!wanted.unknown.length) {
    const decided = bandAnswer(wanted, bands);
    if (decided) return decided;
  }
  // Words or a model the table does not know: the engine searches, and only watch bands it verified may be shown.
  const result = await engine();
  const unverified = result.metadata?.closestFallback && wanted.family;
  const matches = unverified ? [] : result.matches.filter(isWatchBand);
  return { ...result, matches, total: matches.length, status: matches.length ? result.status : 'empty',
    message: matches.length ? result.message : 'לא נמצאה באתר רצועה שמתאימה לחיפוש.',
    metadata: { ...result.metadata, bandsOnly: true } };
}
