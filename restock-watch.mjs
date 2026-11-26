// Back-in-stock watch, for registered profiles only (sessions in session_identities with an e-mail or phone). Such a
// shopper who searched for a product that was sold out is remembered; when that product is on sale again their profile
// gets a flag, so an e-mail or message can be sent later. Nothing is sent from here.
//
// Per store database:
//   restock_watches      one document per (session_id, product_id):
//                        waiting → back_in_stock → (notified_at set by the sender) | purchased | expired
//   restock_state        how far into `queries` the store was read
//   session_identities   back_in_stock + back_in_stock_products, rewritten from the watches on every run;
//                        restock_scanned_at marks a profile whose earlier searches were already read
//
// Reads the store's own `queries` and products, so it works whatever keeps the catalog's stock up to date.
import { ObjectId } from "mongodb";

export const WATCHES = "restock_watches";
export const STATE = "restock_state";
export const RULES = {
  backfillDays: 30,        // a newly registered profile: how far back its searches are read
  expireDays: 90,          // a search (or an unsent flag) older than this is no longer worth a message
  confirmMs: 20 * 60e3,    // in stock this long before it counts, so a sync that flips back and forth flags nothing
  maxMatches: 5,           // a search that fits more sold-out products than this is a browse, not a product
  batch: 2000,
  overlapMs: 2 * 60e3,
  flagProducts: 10,
};

const FILLER = new Set(["של", "עם", "את", "או", "על", "the", "for", "with", "and", "of"]);
// Words about the deal rather than a product: a search made only of these names nothing.
const PROMO = new Set(["משלוח", "חינם", "מבצע", "מבצעים", "מתנה", "חדש", "מועדון", "הצטרפות", "sale", "free", "shipping", "gift", "new"]);

export const normalize = (value) => String(value ?? "")
  .replace(/&#?\w+;|[™®©]/g, " ")
  .normalize("NFD").replace(/\p{M}/gu, "")
  .normalize("NFKC").toLowerCase()
  .replace(/["'׳״’‘`”“]/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

const words = (value) => [...new Set(normalize(value).split(" ").filter((w) => w && !FILLER.has(w)))]; // one-character words stay: Instinct 2 is not Instinct E

function wordMatches(query, name) {
  if (query === name) return true;
  if (/\d/.test(query)) return false; // model numbers and sizes only match exactly: 255 is not 2550
  if (query.length >= 3 && name.startsWith(query) && name.length - query.length <= 2) return true;
  return /^(?:ו?[בהלמש]|ו)(.{2,})$/.exec(name)?.[1] === query;
}

const flat = (value) => (Array.isArray(value) ? value.flatMap(flat) : typeof value === "string" ? [value] : []);

export function buildCatalog(products) {
  const items = [];
  const generic = new Set();
  for (const p of products) {
    const labels = words(flat([p.category, p.categories, p.type, p.softCategory, p.tags, p.brand, p.colors]).join(" "));
    for (const w of labels) generic.add(w);
    const name = String(p.name ?? p.title ?? "").trim();
    const id = String(p.id ?? p.ItemID ?? p._id ?? "");
    if (!name || !id) continue;
    const listed = p.hidden !== true && p.notInStore !== true;
    items.push({
      id,
      name,
      words: words(name),
      about: [...new Set([...words(name), ...labels])],
      url: p.url ?? p.onlineStoreUrl ?? null,
      image: typeof p.image === "string" ? p.image : null,
      soldOut: p.stockStatus === "outofstock",
      // What a shopper could buy at search time (a missing status counts as in stock, as in search).
      available: listed && p.stockStatus !== "outofstock",
      // Stricter for the flag: the store says in stock and the product is shown.
      restocked: listed && p.stockStatus === "instock",
    });
  }
  return { items, generic, byId: new Map(items.map((i) => [i.id, i])) };
}

const covers = (asked, have) => asked.every((q) => have.some((n) => wordMatches(q, n)));

/**
 * The sold-out products a search was after: their names hold every word of the search, and the shopper had nothing
 * else to buy — no product on sale answers it by name, category or brand ("נשים", "אוזניות" are such searches).
 * A search that names a sold-out product in full counts even when relatives of it are on sale.
 */
export function matchSoldOut(catalog, query, rules = RULES) {
  const asked = words(query);
  if (!asked.length || asked.every((w) => PROMO.has(w))) return [];
  const hits = catalog.items.filter((p) => covers(asked, p.words));
  const named = hits.filter((p) => p.words.length > 1 && p.words.every((n) => asked.some((q) => wordMatches(q, n))));
  const pool = named.length ? named : hits;
  if (pool.some((p) => p.available)) return [];
  if (!named.length && hits.length && catalog.items.some((p) => p.available && covers(asked, p.about))) return [];
  const targets = pool.filter((p) => p.soldOut);
  if (!targets.length || targets.length > rules.maxMatches) return [];
  if (!named.length && asked.length === 1) {
    // One word is enough only for a model number, or a distinctive word that is not a category ("ילדים", "יין").
    const [word] = asked;
    const model = /^\d{3,}$/.test(word);
    if (!model && (word.length < 4 || catalog.generic.has(word) || targets.length > 2)) return [];
  }
  return targets;
}

const time = (value) => {
  const t = value instanceof Date ? +value : Date.parse(value);
  return Number.isFinite(t) ? t : null;
};
const chunks = (list, size = 500) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const breathe = () => new Promise((resolve) => setImmediate(resolve));

/**
 * The searches of these sessions since `from`, added to `scan` as one entry per (session, sold-out product). Stock is
 * judged as it is now: exact for the regular runs, while a profile read for the first time also brings older searches
 * for products that have sold out since. (Results shown to the shopper say nothing here: these stores list sold-out
 * products among them.)
 */
async function scanSearches(db, catalog, sessions, from, rules, scan) {
  const queries = db.collection("queries");
  const { found, cache } = scan;
  for (const part of chunks(sessions)) {
    let last = ObjectId.createFromTime(Math.floor(from / 1000));
    for (;;) {
      const rows = await queries.find(
        { _id: { $gt: last }, session_id: { $in: part } },
        { projection: { query: 1, session_id: 1, timestamp: 1 } },
      ).sort({ _id: 1 }).limit(rules.batch).toArray();
      for (const row of rows) {
        scan.searches++;
        const key = normalize(row.query);
        if (!cache.has(key)) {
          cache.set(key, matchSoldOut(catalog, row.query, rules));
          // Matching shares the process with live search.
          if (cache.size % 5 === 0) await breathe();
        }
        const at = time(row.timestamp);
        if (!cache.get(key).length || at === null || !row.session_id) continue;
        scan.matched++;
        for (const product of cache.get(key)) {
          const id = `${row.session_id}\u0000${product.id}`;
          const seen = found.get(id);
          found.set(id, {
            session_id: row.session_id, product, query: String(row.query).slice(0, 200),
            first: Math.min(at, seen?.first ?? at), last: Math.max(at, seen?.last ?? at),
          });
        }
      }
      if (rows.length < rules.batch) break;
      last = rows[rows.length - 1]._id;
    }
  }
}

function watchWrites(found, now) {
  return found.flatMap(({ session_id, product, query, first, last }) => {
    const key = { session_id, product_id: product.id };
    return [
      { updateOne: { filter: key, upsert: true, update: {
        $setOnInsert: { ...key, status: "waiting", status_at: now, created_at: now, notified_at: null },
        $set: { query, product_name: product.name, product_url: product.url, product_image: product.image },
        $min: { first_searched_at: new Date(first) },
        $max: { last_searched_at: new Date(last) },
      } } },
      // Searched again after the watch was closed, and sold out again: watch it again.
      { updateOne: {
        filter: { ...key, status_at: { $lt: new Date(last) },
          $or: [{ status: "expired" }, { status: "purchased" }, { status: "back_in_stock", notified_at: { $ne: null } }] },
        update: { $set: { status: "waiting", status_at: now, notified_at: null, first_searched_at: new Date(last) },
          $unset: { restocked_at: "", seen_in_stock_at: "" } },
      } },
    ];
  });
}

/** What one open watch becomes now, or null when nothing changes. */
export function nextState(watch, product, { now, bought = false, rules = RULES }) {
  const age = (value) => (time(value) === null ? 0 : now - time(value));
  const to = (status, set = {}, unset) => ({ $set: { status, status_at: now, ...set }, ...(unset ? { $unset: unset } : {}) });
  const inStock = product?.restocked === true;
  if (watch.status === "back_in_stock") {
    if (bought) return to("purchased");
    if (!inStock) return to("waiting", {}, { restocked_at: "", seen_in_stock_at: "" });
    return age(watch.restocked_at) > rules.expireDays * 864e5 ? to("expired") : null;
  }
  if (age(watch.last_searched_at) > rules.expireDays * 864e5) return to("expired");
  if (!inStock) {
    return watch.seen_in_stock_at ? { $unset: { seen_in_stock_at: "" } } : null;
  }
  if (!watch.seen_in_stock_at) return { $set: { seen_in_stock_at: now } };
  if (age(watch.seen_in_stock_at) < rules.confirmMs) return null;
  return bought ? to("purchased") : to("back_in_stock", { restocked_at: watch.seen_in_stock_at });
}

// Order lines are named differently by each platform's tracking.
const orderLines = (order) => [order.cart_items, order.products, order.items].filter(Array.isArray).flat();

async function purchases(db, sessions) {
  const bySession = new Map();
  for (const part of chunks(sessions)) {
    const orders = await db.collection("checkout_events").find(
      { session_id: { $in: part }, event_type: "checkout_completed" },
      { projection: { session_id: 1, cart_items: 1, products: 1, items: 1, timestamp: 1, created_at: 1 } },
    ).toArray();
    for (const order of orders) bySession.set(order.session_id, [...(bySession.get(order.session_id) || []), order]);
  }
  return (watch) => (bySession.get(watch.session_id) || []).some((order) =>
    (time(order.created_at) ?? time(order.timestamp) ?? 0) >= (time(watch.first_searched_at) ?? 0)
    && orderLines(order).some((line) => String(line.product_id ?? line.id ?? "") === watch.product_id
      || normalize(line.product_name ?? line.name) === normalize(watch.product_name)));
}

async function evaluateWatches(db, catalog, now, rules) {
  const collection = db.collection(WATCHES);
  const open = await collection.find({ status: { $in: ["waiting", "back_in_stock"] }, notified_at: null }).toArray();
  const buyable = open.filter((w) => w.status === "back_in_stock" || catalog.byId.get(w.product_id)?.restocked);
  const bought = await purchases(db, [...new Set(buyable.map((w) => w.session_id))]);
  const changes = {};
  const writes = [];
  for (const watch of open) {
    const update = nextState(watch, catalog.byId.get(watch.product_id), { now, bought: bought(watch), rules });
    if (!update) continue;
    const status = update.$set?.status;
    if (status) changes[status] = (changes[status] || 0) + 1;
    // Guarded by the state it was read in, so a message marked as sent meanwhile is not undone.
    writes.push({ updateOne: { filter: { _id: watch._id, status: watch.status, notified_at: null }, update } });
  }
  for (const part of chunks(writes)) await collection.bulkWrite(part, { ordered: false });
  return changes;
}

/** Puts the flag on the profile of every session with a restock nobody was told about, and takes it off the rest. */
async function writeFlags(db, rules) {
  const pending = await db.collection(WATCHES).find({ status: "back_in_stock", notified_at: null }).sort({ restocked_at: -1 }).toArray();
  const bySession = new Map();
  for (const w of pending) {
    const list = bySession.get(w.session_id) || [];
    if (list.length < rules.flagProducts) list.push({
      product_id: w.product_id, name: w.product_name, url: w.product_url, image: w.product_image,
      query: w.query, searched_at: w.last_searched_at, restocked_at: w.restocked_at,
    });
    bySession.set(w.session_id, list);
  }
  const identities = db.collection("session_identities");
  for (const part of chunks([...bySession])) {
    await identities.bulkWrite(part.map(([session_id, list]) => ({
      updateOne: { filter: { session_id }, update: { $set: { back_in_stock: true, back_in_stock_products: list } } },
    })), { ordered: false });
  }
  await identities.updateMany({ back_in_stock: true, session_id: { $nin: [...bySession.keys()] } },
    { $set: { back_in_stock: false, back_in_stock_products: [] } });
  return bySession.size;
}

const indexed = new Set();
async function ensureIndexes(db) {
  if (indexed.has(db.databaseName)) return;
  // The unique key is what keeps two runs from creating the same watch twice.
  await db.collection(WATCHES).createIndex({ session_id: 1, product_id: 1 }, { unique: true });
  await db.collection(WATCHES).createIndex({ status: 1, notified_at: 1 });
  await db.collection("session_identities").createIndex({ back_in_stock: 1 }, { sparse: true });
  indexed.add(db.databaseName);
}

/** One pass over one store. With dryRun nothing is written. */
export async function runRestockWatch(db, { dryRun = false, productsCollection = "products", now = new Date(), rules = RULES } = {}) {
  const products = await db.collection(productsCollection).find({}, { projection: {
    id: 1, ItemID: 1, name: 1, title: 1, url: 1, onlineStoreUrl: 1, image: 1, stockStatus: 1, hidden: 1, notInStore: 1,
    category: 1, categories: 1, type: 1, softCategory: 1, tags: 1, brand: 1, colors: 1,
  } }).toArray();
  // An empty read says nothing about stock.
  if (!products.length) return { skipped: "no products" };
  const catalog = buildCatalog(products);
  const state = await db.collection(STATE).findOne({ _id: "queries" });
  const history = +now - rules.backfillDays * 864e5;
  const since = state?.scannedTo ? time(state.scannedTo) - rules.overlapMs : history;
  const registered = await db.collection("session_identities").find(
    { $or: [{ email: { $type: "string" } }, { phone: { $type: "string" } }] },
    { projection: { session_id: 1, restock_scanned_at: 1 } },
  ).toArray();
  // A profile registered since the last run brings the searches it made before anyone knew who it was.
  const fresh = registered.filter((r) => !r.restock_scanned_at).map((r) => r.session_id);
  const known = registered.filter((r) => r.restock_scanned_at).map((r) => r.session_id);
  const scan = { found: new Map(), cache: new Map(), searches: 0, matched: 0 };
  await scanSearches(db, catalog, fresh, history, rules, scan);
  await scanSearches(db, catalog, known, since, rules, scan);
  const found = [...scan.found.values()];
  const summary = { dryRun, products: catalog.items.length, soldOut: catalog.items.filter((i) => i.soldOut).length,
    registered: registered.length, newProfiles: fresh.length, searches: scan.searches, matchedSearches: scan.matched,
    watches: found.length, sessions: new Set(found.map((f) => f.session_id)).size };
  if (dryRun) return { ...summary, found };
  await ensureIndexes(db);
  for (const part of chunks(watchWrites(found, now))) await db.collection(WATCHES).bulkWrite(part, { ordered: true });
  await db.collection(STATE).updateOne({ _id: "queries" }, { $set: { scannedTo: now } }, { upsert: true });
  for (const part of chunks(fresh)) {
    await db.collection("session_identities").updateMany({ session_id: { $in: part } }, { $set: { restock_scanned_at: now } });
  }
  const changes = await evaluateWatches(db, catalog, now, rules);
  const flaggedSessions = await writeFlags(db, rules);
  return { ...summary, changes, flaggedSessions };
}

/** For the sender: one entry per customer who can be reached, with the products that came back. */
export async function pendingNotifications(db) {
  const watches = await db.collection(WATCHES).find({ status: "back_in_stock", notified_at: null }).sort({ restocked_at: -1 }).toArray();
  if (!watches.length) return [];
  const identities = await db.collection("session_identities").find(
    { session_id: { $in: [...new Set(watches.map((w) => w.session_id))] } },
    { projection: { session_id: 1, email: 1, phone: 1, first_name: 1 } },
  ).toArray();
  const who = new Map(identities.map((i) => [i.session_id, i]));
  const customers = new Map();
  for (const watch of watches) {
    const identity = who.get(watch.session_id);
    const key = identity?.email || identity?.phone;
    if (!key) continue;
    const customer = customers.get(key) || { email: identity.email || null, phone: identity.phone || null,
      first_name: identity.first_name || null, products: [], watchIds: [] };
    customer.watchIds.push(watch._id);
    if (!customer.products.some((p) => p.product_id === watch.product_id)) customer.products.push({
      product_id: watch.product_id, name: watch.product_name, url: watch.product_url, image: watch.product_image,
      query: watch.query, restocked_at: watch.restocked_at,
    });
    customers.set(key, customer);
  }
  return [...customers.values()];
}

/** After a message went out: the same restock is not reported again. The flag comes off on the next run. */
export async function markNotified(db, watchIds, { channel = "email", now = new Date() } = {}) {
  await db.collection(WATCHES).updateMany({ _id: { $in: watchIds }, notified_at: null },
    { $set: { notified_at: now, notified_channel: channel, status_at: now } });
}

/** Runs the listed stores one after another, then waits. Off when no store is listed. */
export function startRestockWatch({ stores, getDb, productsCollection = async () => "products",
  intervalMs = 30 * 60e3, firstDelayMs = 5 * 60e3, run = runRestockWatch, log = console } = {}) {
  const list = String(stores || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return null;
  let timer, stopped = false;
  const later = (ms) => { if (!stopped) { timer = setTimeout(pass, ms); timer.unref?.(); } };
  async function pass() {
    for (const store of list) {
      try {
        const result = await run(await getDb(store), { productsCollection: await productsCollection(store) });
        log.log(`[RESTOCK] ${store}: ${JSON.stringify(result)}`);
      } catch (error) {
        log.error(`[RESTOCK] ${store}: ${error.message}`);
      }
    }
    later(intervalMs);
  }
  later(firstDelayMs);
  return () => { stopped = true; clearTimeout(timer); };
}
