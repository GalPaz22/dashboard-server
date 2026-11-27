// Searches for the sale itself ("ספרים ב-10", "בלאק פריידי", "מבצעים"). The index matched their words against titles
// ("ספרים ב 10 שקל" → ₪79 books, "מבצע" → the spy series "מבצע מנהטן"), so they are answered from the campaign tags the
// store puts on its products. Everything here follows those tags: when a campaign ends and the tags leave, the search
// goes back to the index by itself.
const TIERS = [10, 20, 30, 40, 50];
const NUMBER_WORDS = new Map([['עשרה', 10], ['עשר', 10], ['עשרים', 20], ['שלושים', 30], ['ארבעים', 40], ['חמישים', 50]]);
const SALE_WORDS = new Set(['מבצע', 'מבצעים', 'מבצעי', 'הנחה', 'הנחות', 'זולים', 'זול', 'בזול', 'דיל', 'דילים', 'sale']);
const MONEY = new Set(['שקל', 'שקלים', 'שח', 'nis', 'ils']);
const BOOKS = new Set(['ספר', 'ספרים', 'ספרי', 'book', 'books']);
const NEUTRAL = new Set(['של', 'את', 'כל', 'רק', 'יש', 'לי', 'אתר', 'באתר', 'חנות', 'בחנות', 'החנות', 'נובמבר', 'חורף', 'חג', 'in', 'on', 'at', 'the', 'ב', 'ה', 'ו', 'עד', ...BOOKS, ...MONEY]);
const KINDS = new Map(Object.entries({
  english: ['אנגלית', 'באנגלית', 'לועזית', 'לועזיים', 'english'],
  digital: ['דיגיטלי', 'דיגיטליים', 'דיגטלים', 'דיגטליים', 'דיגיטלים'],
  games: ['משחק', 'משחקים', 'משחקי', 'צעצועים', 'צעצוע', 'פאזל', 'פאזלים'],
}).flatMap(([kind, list]) => list.map(word => [word, kind])));
const AUDIENCES = new Map(Object.entries({
  kids: ['ילדים', 'לילדים', 'לקטנים', 'פעוטות', 'לפעוטות'],
  youth: ['נוער', 'לנוער'],
  comics: ['קומיקס'],
}).flatMap(([audience, list]) => list.map(word => [word, audience])));
const FRIDAY = /^(?:פריידי|פרידי|פרידיי|פריידיי|פרייד|friday)$/;
const BLACK = /^(?:בלאק|בלק|black)$/;

const tokens = query => String(query || '').normalize('NFKC').toLocaleLowerCase('he')
  .replace(/[֑-ׇ]/g, '').replace(/["'`׳״’”]/g, '').replace(/₪/g, ' שקל ').replace(/blackfriday/g, 'black friday')
  .replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)(\p{L})/gu, '$1 $2').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);

/**
 * What a search asks of the sale, or null when it is about anything else: every word must be a sale word, a price, a kind
 * of product or an audience ("מבצע ברלין", "דיל עם אלוהים", "פריידי מרגלית" are titles and names).
 */
export function parseSaleQuery(query) {
  const words = tokens(query);
  if (!words.length || words.length > 8) return null;
  const out = {tier: null, max: null, kind: null, audience: null, books: false};
  let sale = false, priced = false;
  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    // A word as typed, or after a glued ו / ה / ב / ל ("ובלק", "במבצע", "הנחה" stays "הנחה").
    const known = w => SALE_WORDS.has(w) || NEUTRAL.has(w) || KINDS.has(w) || AUDIENCES.has(w) || NUMBER_WORDS.has(w) || BLACK.test(w) || FRIDAY.test(w) || /^\d+$/.test(w);
    const word = known(raw) ? raw : /^[והבל]/.test(raw) && known(raw.slice(1)) ? raw.slice(1) : raw;
    const next = words[i + 1] || '';
    if (BLACK.test(word) && FRIDAY.test(next.replace(/^ו/, ''))) { sale = true; i++; continue; }
    const amount = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS.get(word);
    if (amount !== undefined) {
      if (!TIERS.includes(amount) || out.tier !== null || out.max !== null) return null;
      const before = words[i - 1] || '';
      // "ב 10", "עד 30", "10 שקל", "בעשרה": a number alone is a volume or a year.
      if (before === 'עד') out.max = amount;
      else if (before === 'ב' || raw !== word && raw.startsWith('ב') || MONEY.has(next)) out.tier = amount;
      else return null;
      priced = true;
      continue;
    }
    if (SALE_WORDS.has(word)) { sale = true; continue; }
    if (KINDS.has(word)) { out.kind = KINDS.get(word); continue; }
    if (AUDIENCES.has(word)) { out.audience = AUDIENCES.get(word); continue; }
    if (BOOKS.has(word)) { out.books = true; continue; }
    if (NEUTRAL.has(word)) continue;
    return null;
  }
  return sale || priced ? out : null;
}

const BADGES = {
  hebrew: /^ספר ?(?:10|20|30|40|50)$/,
  english: /^EN ?(?:10|20|30|40|50)$/,
  games: /^מבצע משחקים$/,
  digital: /^₪ ?2[45]$/,
};
/** The badge values to look for in the database (the concierge reads Mongo, not the search runtime). */
export const saleBadgeValues = () => [...TIERS.flatMap(t => [`ספר${t}`, `ספר ${t}`, `EN${t}`, `EN ${t}`]), 'מבצע משחקים', '₪ 24', '₪ 25', '₪24', '₪25'];

// The store's games sale page ("צעצועים ומשחקים 10 עד ₪50") is marked as an offer on the product, not as a badge.
export const GAMES_OFFER = /^צעצועים ומשחקים \d+ עד/u;
const inGamesOffer = (label, price) => Number(price) <= 50 && (label.offers || []).some(o => o?.enabled !== false && GAMES_OFFER.test(String(o?.value || '')));

// department: the store's own shelf ("ספרים בעברית_ראשית קריאה"), set on many books that have no category.
const AUDIENCE_TEXT = {kids: /ילדים|פעוטות|ראשית קריאה|דפים עבים|נוער צעיר/u, youth: /נוער/u, comics: /קומיקס|מנגה/u};

/** Which campaign a product belongs to for this search ('hebrew', 'english', 'games', 'digital'), or null. */
export function saleKind(product, sale) {
  const label = product.specialLabel || {};
  const own = [label.badge?.value, label.printed?.badge].filter(Boolean).map(String);
  const digital = label.digital?.enabled !== false && label.digital?.badge ? String(label.digital.badge) : '';
  let kind = Object.keys(BADGES).find(k => k !== 'digital' && own.some(b => BADGES[k].test(b))) || null;
  if (sale.kind === 'digital' || !kind) kind = BADGES.digital.test(digital) || own.some(b => BADGES.digital.test(b)) ? 'digital' : sale.kind === 'digital' ? null : kind;
  if (!kind && inGamesOffer(label, product.price)) kind = 'games';
  if (!kind) return null;
  if (sale.kind ? kind !== sale.kind : kind === 'digital' && sale.tier !== null) return null;
  if (sale.books && !sale.kind && kind === 'games') return null;
  const price = Number(kind === 'digital' ? label.digital?.value ?? product.price : product.price);
  if (!(price > 0) || sale.tier !== null && price !== sale.tier || sale.max !== null && price > sale.max) return null;
  if (sale.audience && !AUDIENCE_TEXT[sale.audience].test([product.title, product.name, product.department, ...(product.categories || []), ...(product.productTypes || [])].join(' '))) return null;
  return kind;
}

const skuOf = p => String(p.sku || p.id || '').split(':').pop();
/**
 * The campaign products for a sale search, best sellers of the week first; Hebrew books lead unless another kind was
 * asked. One row per title. attach adds the live label fields to a catalog product.
 */
export function saleListing(products, sale, {attach = p => p, sold = new Map(), limit = 500} = {}) {
  const found = [];
  for (const product of products) {
    if (product.hidden || product.stockStatus !== 'instock') continue;
    const live = attach(product), kind = saleKind(live, sale);
    if (!kind) continue;
    // For games, the sale page's own list comes before the store's standing games discount.
    found.push({product, kind, listed: sale.kind !== 'games' || inGamesOffer(live.specialLabel || {}, live.price), sold: sold.get(skuOf(product)) || 0});
  }
  const lead = row => (sale.kind ? row.listed : row.kind === 'hebrew') ? 0 : 1;
  found.sort((a, b) => lead(a) - lead(b) || b.sold - a.sold || (b.product.popularity || 0) - (a.product.popularity || 0) || String(a.product.id).localeCompare(String(b.product.id)));
  const titles = new Set();
  return found.filter(({product}) => {
    const key = `${product.title ?? product.name}|${product.specifications?.author ?? product.author ?? ''}`;
    return !titles.has(key) && titles.add(key);
  }).slice(0, limit).map(row => row.product);
}

/**
 * Copies sold per product in the last days, from the store's completed orders. The first call waits briefly; later ones
 * answer from memory while an hourly refresh runs behind them. Without orders the listing keeps the catalog's order.
 */
export function createSalesRank({days = 7, ttlMs = 3600000, waitMs = 1500, now = Date.now} = {}) {
  let sold = new Map(), at = -Infinity, loading = null;
  async function load(orders) {
    const since = new Date(now() - days * 864e5).toISOString();
    const rows = await orders.find({event_type: 'checkout_completed', timestamp: {$gte: since}}, {projection: {_id: 0, items: 1}}).toArray();
    const next = new Map();
    for (const order of rows) for (const item of order.items || []) {
      const key = String(item.id || '').split(':').pop();
      if (key) next.set(key, (next.get(key) || 0) + (Number(item.quantity) || 1));
    }
    sold = next; at = now();
  }
  return async function rank(orders) {
    if (!orders) return sold;
    if (now() - at >= ttlMs && !loading) loading = load(orders).catch(e => { at = now() - ttlMs + 60000; console.error('[STEIMATZKY SALE] sales rank failed -', e.message); }).finally(() => { loading = null; });
    if (loading && at === -Infinity) { let timer; await Promise.race([loading, new Promise(r => { timer = setTimeout(r, waitMs); })]); clearTimeout(timer); }
    return sold;
  };
}
