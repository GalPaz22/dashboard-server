// The store's spec sheets (WooCommerce attributes) are sometimes copied from another model or size. Found 26.11.2026:
// every Venu 4 carries the Venu 3 45mm sheet, so the 41mm cards say "45x45x12", 1.4", 22mm band and "Venu 3 in the
// box", and the concierge compared them as 45mm watches. Two layers:
//   1. VERIFIED: figures checked against the manufacturer replace the store's for the model they name.
//   2. Any other product whose title states one case size and whose sheet states another has a sheet that belongs to a
//      different watch: everything that changes with size is withheld (shown as "not listed"), the title's size stays.
// Remove a VERIFIED entry once the store's own sheet is fixed.

// Garmin product pages and the Venu 4 owner's manual, read 26.11.2026:
// https://www.garmin.com/en-US/p/1613801/ , https://ph.garmin.com/products/wearables/venu-4-41-bone/
const venu4 = (size, v) => ({
  'דגם': 'Venu 4',
  'גודל השעון': `${size} מ"מ`,
  'קוטר': `${v.physical} מ"מ`,
  'מתאים להיקף יד': `${v.wrist} מ"מ`,
  'משקל': `${v.withBand} גרם עם הרצועה (${v.bare} גרם בלעדיה)`,
  'גודל מסך תצוגה': `${v.display}"`,
  'רזולוציית תצוגה': `${v.pixels} פיקסלים`,
  'תאימות לסוג רצועה': `Quick Release ${v.band}mm`,
  'חיי סוללה': `מצב שעון חכם: עד ${v.days} ימים. מצב GPS בלבד: עד ${v.gps} שעות`,
  'פנס LED': '✓',
});
export const VERIFIED = [
  { name: /\bvenu\s*4\b/i, size: 41, attributes: venu4(41, { physical: '41x41x12', wrist: '110-175', withBand: 46, bare: 33, display: '1.2', pixels: '390x390', band: 18, days: 10, gps: 15 }) },
  { name: /\bvenu\s*4\b/i, size: 45, attributes: venu4(45, { physical: '45x45x12.5', wrist: '135-200', withBand: 56, bare: 38, display: '1.4', pixels: '454x454', band: 22, days: 12, gps: 20 }) },
];

// Attributes that differ between sizes, by the store's names.
const SIZE_BOUND = ['גודל השעון', 'קוטר', 'גודל פיזי', 'מידות פיזיות', 'משקל', 'מתאים להיקף יד', 'גודל מסך תצוגה', 'גודל תצוגה',
  'pa_גודל-מסך-תצוגה', 'רזולוציית תצוגה', 'רזולוציית מסך', 'תאימות לסוג רצועה', 'תואם לרצועת שעון QuickFit®', 'תאימות לרצועות ™QuickFit',
  'הרכב הרצועה', 'חיי סוללה', 'זמן סוללה - שעון חכם', 'חיי סוללה (מצב שעון חכם)', 'מה בערכה', 'דגם'];
const SIZE_SOURCES = ['גודל השעון', 'קוטר', 'מידות פיזיות', 'גודל פיזי'];

const plainName = (name) => String(name || '').replace(/[®™℠]/g, '').replace(/&nbsp;| /g, ' ');
export function titleSize(name) {
  const match = plainName(name).match(/(?<![\d.])(\d{2})\s*(?:mm|מ["״]?מ)(?![a-z])/i);
  const size = match ? Number(match[1]) : null;
  // Watch cases only: a 14–26mm figure in a title is a band width.
  return size && size >= 30 && size <= 60 ? size : null;
}
function sheetSize(attributes) {
  for (const source of SIZE_SOURCES) {
    const value = attributes.find((a) => String(a?.name || '').trim() === source)?.options?.[0];
    const number = Number(String(value ?? '').match(/\d+(?:\.\d+)?/)?.[0]);
    if (number >= 30 && number <= 60) return number;
  }
  return null;
}

export const verifiedFor = (name) => {
  const size = titleSize(name);
  return size ? VERIFIED.find((v) => v.size === size && v.name.test(plainName(name))) || null : null;
};

/** The product as comparisons and spec answers should read it; `specNote` says what was done and why. */
export function correctSheet(product) {
  const attributes = product?.attributes || [];
  if (!attributes.length) return product;
  const verified = verifiedFor(product.name);
  if (verified) {
    const kept = attributes.filter((a) => !Object.hasOwn(verified.attributes, String(a?.name || '').trim()))
      .map((a) => (String(a?.name || '').trim() === 'מה בערכה'
        ? { ...a, options: a.options.map((o) => String(o).replace(/Venu®?\s*3\b/g, 'Venu 4')) } : a));
    return { ...product, attributes: [...kept, ...Object.entries(verified.attributes).map(([name, value]) => ({ name, options: [value] }))] };
  }
  const title = titleSize(product.name);
  const sheet = title ? sheetSize(attributes) : null;
  // 1.5mm of slack: sheets give 45.4 for a "45mm" watch.
  if (!title || !sheet || Math.abs(title - sheet) < 1.5) return product;
  return {
    ...product,
    attributes: [...attributes.filter((a) => !SIZE_BOUND.includes(String(a?.name || '').trim())), { name: 'גודל השעון', options: [`${title} מ"מ`] }],
    specNote: `מפרט החנות למוצר הזה שייך לגודל אחר (${sheet} מ"מ) ולכן נתוני הגודל, המשקל, המסך והסוללה אינם מוצגים. אל תציין אותם.`,
  };
}

/** The store's Venu 4 descriptions state the screen and battery of one size on both; the model reads them corrected. */
export function correctDescription(name, text) {
  const verified = verifiedFor(name);
  if (!verified || !text) return text;
  const a = verified.attributes;
  const days = a['חיי סוללה'].match(/עד (\d+) ימים/)[1];
  const gps = a['חיי סוללה'].match(/עד (\d+) שעות/)[1];
  return String(text)
    .replace(/1\.[24](\s*(?:אינץ|אינטש|inch|["”]))/g, `${a['גודל מסך תצוגה'].replace('"', '')}$1`)
    .replace(/(עד\s*)\d+(\s*ימים)/g, `$1${days}$2`)
    .replace(/(עד\s*)\d+(\s*שעות(?:\s*(?:ב)?(?:מצב\s*)?\s*GPS))/g, `$1${gps}$2`);
}
