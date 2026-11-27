// The model often names books without calling present_products (201 of 704 turns, 22–27.11): the shopper reads titles
// and has nothing to open. These are the products of this turn that such a reply names, so they can be put on screen.
const fold = value => String(value || '').normalize('NFKC').toLocaleLowerCase('he').replace(/[֑-ׇ]/g, '')
  .replace(/["'`׳״’‘“”„]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// "…", ״…״, *…* ; a one-letter prefix may be glued before the mark (ו״ההסכם״). The marks inside ש״ח or ג׳ון don't open one.
const QUOTED = /(?<![\p{L}\p{N}])(?:[והבלמש][-־]?)?["“”״„*«]+([^"“”״„*«»\n]{1,120}?)["“”״*»]+(?![\p{L}\p{N}])/gu;
const GAME_SUFFIX = / (?:משחק(?: (?:קופסה|קופסא|קלפים))?)$/u;
// "ספרים שמתחילים ב״להציל את״" quotes an opening, not a title.
const OPEN_ENDED = / (?:את|של|על|עם|אל|בין|מה|the|of|a|an|to|and)$/u;
// A title that opens like ordinary talk ("סיפור אהבה", "ספר מתח") counts only in quotes.
const TALK = /^(?:ה?ספר|ספרי|ה?ספרים|ה?סיפור|ה?סדרה|סדרת|מארז|ה?משחק) /u;
// "Something like X", "I read X": X is what the shopper has, not what is offered.
const HAS_IT = /דומה|כמו|בסגנון|קראתי|קראנו|יש לי|כבר/u;

// The catalog's name carries more than the reply says: "המטרה/ דיוויד באלדאצ'י", "משחקי הרעב 1 מהדורה חדשה 2020",
// "ג'ק טיילור 4 פ' זה פחד" (series, volume, title).
const EDITION = / (?:מהדורה|מהד|כריכה|כריכת) .*$/u;
const whole = name => [fold(name), fold(String(name || '').split(/\/|\(|\s[-–]|[-–](?=כריכ)/u)[0])].map(t => t.replace(GAME_SUFFIX, ''));
const shortened = name => whole(name).flatMap(title => {
  const plain = title.replace(EDITION, ''), tail = plain.match(/^.+? \d{1,2} (.+)$/u)?.[1];
  return [plain, plain.replace(/ 1$/u, ''), ...(tail ? [tail] : [])];
});

/** Product ids the reply names, in the order it names them. asked: the shopper's message, or the search that opened the chat. */
export function namedInReply(reply, products, {asked = '', limit = 5} = {}) {
  const theirs = HAS_IT.test(String(asked || '')) ? ` ${fold(asked)} ` : '';
  // titles: every form a quoted name may take, the full names first. spoken: the forms also read without quotes.
  const titles = new Map(), spoken = new Set(), has = new Set();
  for (const forms of [whole, shortened]) {
    for (const product of products || []) {
      const id = String(product.product_id);
      for (const title of forms(product.name)) {
        if (title.length < 2) continue;
        // "למשחקי הרעב" names it too.
        if (new RegExp(` [והבלמשכ]?${title} `, 'u').test(theirs)) has.add(id);
        if (titles.has(title)) continue;
        titles.set(title, id);
        if (forms === whole) spoken.add(title);
      }
    }
  }
  let said = ` ${fold(reply)} `;
  const found = [];
  const take = (id, at, length) => {
    found.push({id, at});
    said = said.slice(0, at) + '|'.repeat(length) + said.slice(at + length);
  };
  // In quotes: the whole title, or its opening words ("On Leadership" for a title that goes on to a subtitle).
  for (const [, quoted] of String(reply || '').matchAll(QUOTED)) {
    const text = fold(quoted);
    if (!text) continue;
    const title = titles.has(text) ? text : text.includes(' ') && !OPEN_ENDED.test(text) ? [...titles.keys()].filter(t => t.startsWith(`${text} `)).sort((a, b) => a.length - b.length)[0] : null;
    const at = said.indexOf(` ${text} `);
    if (title && at >= 0) take(titles.get(title), at + 1, text.length);
  }
  // Without quotes: a whole title of two words or more, the longest first so a title inside another isn't counted twice.
  for (const title of [...spoken].sort((a, b) => b.length - a.length)) {
    if (title.length < 5 || !title.includes(' ') || TALK.test(title)) continue;
    const match = said.match(new RegExp(`(?<= [והבלמש]?)${title}(?= )`, 'u'));
    if (match) take(titles.get(title), match.index, title.length);
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map(f => f.id))].filter(id => !has.has(id)).slice(0, limit);
}
