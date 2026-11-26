import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { buildCatalog, matchSoldOut, runRestockWatch, pendingNotifications, markNotified, startRestockWatch } from "./restock-watch.mjs";

// Just enough of MongoDB for the operators restock-watch uses.
const same = (a, b) => (a instanceof ObjectId || b instanceof ObjectId ? String(a) === String(b) : a === b || +a === +b && a instanceof Date);
const matches = (doc, filter = {}) => Object.entries(filter).every(([key, want]) => {
  if (key === "$or") return want.some((f) => matches(doc, f));
  const have = doc[key];
  if (want && typeof want === "object" && !(want instanceof Date) && !(want instanceof ObjectId)) {
    return Object.entries(want).every(([op, value]) => {
      if (op === "$in") return value.some((v) => same(have, v));
      if (op === "$nin") return !value.some((v) => same(have, v));
      if (op === "$ne") return value === null ? have != null : !same(have, value);
      if (op === "$type") return typeof have === value;
      if (op === "$gt") return String(have) > String(value);
      if (op === "$lt") return have < value;
      throw new Error("unsupported " + op);
    });
  }
  return want === null ? have == null : same(have, want);
});
const apply = (doc, update, inserted) => {
  if (inserted) Object.assign(doc, update.$setOnInsert);
  Object.assign(doc, update.$set);
  for (const key of Object.keys(update.$unset || {})) delete doc[key];
  for (const [key, v] of Object.entries(update.$min || {})) if (doc[key] === undefined || v < doc[key]) doc[key] = v;
  for (const [key, v] of Object.entries(update.$max || {})) if (doc[key] === undefined || v > doc[key]) doc[key] = v;
};
function fakeDb(seed = {}) {
  const data = Object.fromEntries(Object.entries(seed).map(([k, rows]) => [k, rows.map((r) => ({ _id: new ObjectId(), ...r }))]));
  const collection = (name) => {
    const rows = (data[name] ||= []);
    const one = async (filter, update, { upsert } = {}) => {
      let doc = rows.find((r) => matches(r, filter));
      if (doc) return apply(doc, update, false);
      if (!upsert) return;
      doc = { _id: filter._id ?? new ObjectId(), ...Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== "object")) };
      apply(doc, update, true);
      rows.push(doc);
    };
    return {
      find(filter) {
        let out = rows.filter((r) => matches(r, filter));
        const cursor = {
          sort(spec) { const [[key, dir]] = Object.entries(spec); out.sort((a, b) => dir * String(a[key]).localeCompare(String(b[key]))); return cursor; },
          limit(n) { out = out.slice(0, n); return cursor; },
          toArray: async () => out.map((r) => ({ ...r })),
        };
        return cursor;
      },
      findOne: async (filter) => rows.find((r) => matches(r, filter)) || null,
      updateOne: one,
      updateMany: async (filter, update) => { for (const r of rows.filter((x) => matches(x, filter))) apply(r, update, false); },
      bulkWrite: async (ops) => { for (const { updateOne: u } of ops) await one(u.filter, u.update, { upsert: u.upsert }); },
      createIndex: async () => {},
    };
  };
  return { databaseName: "shop" + Math.random(), collection, data };
}

const START = new Date("2026-11-20T10:00:00Z");
const later = (minutes) => new Date(+START + minutes * 60e3);
const search = (query, session_id, at = later(-60)) => ({ _id: ObjectId.createFromTime(Math.floor(at / 1000)), query, session_id, timestamp: at });
const watch1 = () => fakeDb({
  products: [
    { id: 1, name: "לק ג'ל 290 - tres jolie", stockStatus: "outofstock", category: "לק ג'ל" },
    { id: 2, name: "לק ג'ל 291 - tres jolie", stockStatus: "instock", category: "לק ג'ל" },
  ],
  queries: [search("290", "s1"), search("291", "s2"), search("לק גל 290", "anon")],
  session_identities: [{ session_id: "s1", email: "a@example.com", first_name: "A" }, { session_id: "s2", phone: "0500000000" }],
});
const stock = (db, id, stockStatus) => { db.data.products.find((p) => p.id === id).stockStatus = stockStatus; };
const states = (db) => Object.fromEntries(db.data.restock_watches.map((w) => [w.session_id, w.status]));
const identity = (db) => db.data.session_identities[0];

test("a search for a sold-out product is watched, and flagged only once the restock holds", async () => {
  const db = watch1();
  const first = await runRestockWatch(db, { now: START });
  assert.equal(first.watches, 1);
  assert.deepEqual(states(db), { s1: "waiting" }, "an unregistered shopper is not watched");
  assert.equal(identity(db).back_in_stock, undefined);

  stock(db, 1, "instock");
  await runRestockWatch(db, { now: later(30) });
  assert.deepEqual(states(db), { s1: "waiting" });

  const third = await runRestockWatch(db, { now: later(60) });
  assert.equal(third.flaggedSessions, 1);
  assert.deepEqual(states(db), { s1: "back_in_stock" });
  assert.equal(identity(db).back_in_stock, true);
  assert.equal(identity(db).back_in_stock_products[0].product_id, "1");
  assert.equal(identity(db).back_in_stock_products[0].query, "290");
  assert.equal(+identity(db).back_in_stock_products[0].restocked_at, +later(30));
  assert.equal(db.data.session_identities[1].back_in_stock, undefined);
  assert.equal(db.data.session_identities.length, 2, "no profile is invented");
});

test("a restock that flips back within the confirmation time flags nothing", async () => {
  const db = watch1();
  await runRestockWatch(db, { now: START });
  stock(db, 1, "instock");
  await runRestockWatch(db, { now: later(30) });
  stock(db, 1, "outofstock");
  await runRestockWatch(db, { now: later(60) });
  assert.equal(db.data.restock_watches[0].seen_in_stock_at, undefined);
  assert.equal(states(db).s1, "waiting");
});

test("sold out again before a message went out takes the flag off", async () => {
  const db = watch1();
  await runRestockWatch(db, { now: START });
  stock(db, 1, "instock");
  await runRestockWatch(db, { now: later(30) });
  await runRestockWatch(db, { now: later(60) });
  stock(db, 1, "outofstock");
  await runRestockWatch(db, { now: later(90) });
  assert.equal(states(db).s1, "waiting");
  assert.equal(identity(db).back_in_stock, false);
  assert.deepEqual(identity(db).back_in_stock_products, []);
});

test("the customers to send to are listed once, and a sent message is not repeated", async () => {
  const db = watch1();
  await runRestockWatch(db, { now: START });
  stock(db, 1, "instock");
  await runRestockWatch(db, { now: later(30) });
  await runRestockWatch(db, { now: later(60) });
  const pending = await pendingNotifications(db);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].email, "a@example.com");
  assert.equal(pending[0].products.length, 1);

  await markNotified(db, pending[0].watchIds, { now: later(61) });
  await runRestockWatch(db, { now: later(90) });
  assert.equal(identity(db).back_in_stock, false);
  assert.deepEqual(await pendingNotifications(db), []);

  // Sold out and searched again: watched again.
  stock(db, 1, "outofstock");
  db.data.queries.push(search("290", "s1", later(120)));
  await runRestockWatch(db, { now: later(121) });
  const again = db.data.restock_watches.find((w) => w.session_id === "s1");
  assert.equal(again.status, "waiting");
  assert.equal(again.notified_at, null);
});

test("a shopper who already bought it is not flagged", async () => {
  const db = watch1();
  await runRestockWatch(db, { now: START });
  db.data.checkout_events = [{ session_id: "s1", event_type: "checkout_completed", timestamp: later(40), items: [{ product_id: 1 }] }];
  stock(db, 1, "instock");
  await runRestockWatch(db, { now: later(30) });
  await runRestockWatch(db, { now: later(60) });
  assert.deepEqual(states(db), { s1: "purchased" });
  assert.equal(identity(db).back_in_stock, undefined);
});

test("a profile registered later brings its earlier searches; a known one is read from the last run on", async () => {
  const db = watch1();
  await runRestockWatch(db, { now: START });
  assert.ok(db.data.session_identities.every((i) => i.restock_scanned_at));

  db.data.session_identities.push({ _id: new ObjectId(), session_id: "anon", email: "b@example.com" });
  // s2 searched 291 while it was on sale; selling out later does not turn that old search into a watch.
  stock(db, 2, "outofstock");
  const next = await runRestockWatch(db, { now: later(30) });
  assert.equal(next.newProfiles, 1);
  assert.deepEqual(states(db), { s1: "waiting", anon: "waiting" });
});

test("an old search expires, and a hidden product is not back in stock", async () => {
  const db = watch1();
  await runRestockWatch(db, { now: START });
  stock(db, 1, "instock");
  db.data.products[0].hidden = true;
  await runRestockWatch(db, { now: later(30) });
  await runRestockWatch(db, { now: later(60) });
  assert.equal(states(db).s1, "waiting");
  db.data.products[0].hidden = false;
  await runRestockWatch(db, { now: later(91 * 24 * 60) });
  assert.equal(states(db).s1, "expired");
});

test("a dry run and an empty catalog write nothing", async () => {
  const db = watch1();
  const dry = await runRestockWatch(db, { now: START, dryRun: true });
  assert.equal(dry.found.length, 1);
  assert.equal(db.data.restock_watches, undefined);
  assert.equal(identity(db).restock_scanned_at, undefined);
  assert.deepEqual(await runRestockWatch(fakeDb({ products: [] })), { skipped: "no products" });
});

const names = (products, query) => matchSoldOut(buildCatalog(products), query).map((p) => p.name);
const out = (name, extra) => ({ id: name, name, stockStatus: "outofstock", ...extra });
const sold = (name, extra) => ({ id: name, name, stockStatus: "instock", ...extra });

test("what counts as a search for a sold-out product", () => {
  const catalog = [
    out("אוזניות Skullcandy"), out("צמיד לנשים HRM-Fit"), sold("Forerunner 265", { softCategory: ["נשים"] }),
    out("Instinct E"), out("Instinct 2"), sold("Instinct 3"),
    out("Forerunner 255 | 46mm"), sold("Forerunner 255 Music | 46mm"),
    out("Forerunner 2550"), out("מגן מסך לאופנוע", { category: "אביזרים" }), out("ארגז מועדון"),
  ];
  assert.deepEqual(names(catalog, "נשים"), [], "an on-sale product answers it by its category");
  assert.deepEqual(names(catalog, "instinct 2"), ["Instinct 2"], "not Instinct E");
  assert.deepEqual(names(catalog, "instinct"), [], "relatives are on sale");
  assert.deepEqual(names(catalog, "Forerunner 255 46mm"), ["Forerunner 255 | 46mm"], "named in full");
  assert.deepEqual(names(catalog, "255"), [], "an on-sale 255 exists");
  assert.deepEqual(names(catalog, "אביזרים"), []);
  assert.deepEqual(names(catalog, "מועדון"), []);
  assert.deepEqual(names(catalog, ""), []);
  assert.deepEqual(names([out("לק גל 290"), out("לק גל 2900")], "290"), ["לק גל 290"]);
  assert.deepEqual(names([out("וילה לימונצ'לו")], "לימונצלו"), ["וילה לימונצ'לו"]);
  assert.deepEqual(names(Array.from({ length: 6 }, (_, i) => out(`ריזלינג יבש ${i + 10}`)), "ריזלינג יבש"), [], "a browse");
});

test("the schedule is off without a store list", () => {
  assert.equal(startRestockWatch({ stores: "" }), null);
  assert.equal(startRestockWatch({}), null);
});
