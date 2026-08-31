import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { MongoClient } from "/Users/galpaz/Desktop/dashboard-server/node_modules/mongodb/lib/index.js";
process.on("uncaughtException", e => { console.error(`ERR: ${e.message}`); process.exit(1); });
process.on("unhandledRejection", e => { console.error(`ERR: ${e?.message || e}`); process.exit(1); });

const outputDir = "/Users/galpaz/Desktop/dashboard-server/outputs/steimatzky-zero-conversions";
const asOf = new Date();
const maxGapMs = 2 * 60 * 60 * 1000;
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
await client.connect();
const db = client.db("steimatzky");
const zeroDocs = await db.collection("zero_searches").find({ session_id: { $type: "string", $ne: "" } }).project({ session_id: 1, query: 1, first_seen: 1 }).toArray();
const bySession = new Map();
for (const z of zeroDocs) {
  if (!bySession.has(z.session_id)) bySession.set(z.session_id, []);
  bySession.get(z.session_id).push({ query: z.query, time: new Date(z.first_seen) });
}
const ids = [...bySession.keys()];
const [cartDocs, checkoutDocs] = await Promise.all([
  db.collection("cart").find({ session_id: { $in: ids } }).toArray(),
  db.collection("tracking_events").find({ event_type: "checkout", session_id: { $in: ids } }).toArray(),
]);
await client.close();

const bot = /bot|crawler|spider|slurp|facebookexternalhit|meta-externalads/i;
const events = [];
function capture(doc, type) {
  if (type === "checkout" && bot.test(doc.user_agent || "")) return;
  const eventTime = new Date(doc.timestamp || doc.created_at);
  const candidates = (bySession.get(doc.session_id) || []).filter(z => eventTime - z.time >= 0 && eventTime - z.time <= maxGapMs).sort((a, b) => b.time - a.time);
  if (!candidates.length) return;
  const z = candidates[0];
  events.push({
    sessionId: doc.session_id, zeroQuery: z.query, zeroTime: z.time, eventTime, type,
    minutes: Math.round((eventTime - z.time) / 60000),
    value: doc.cart_total ?? doc.cart_value ?? doc.order_total ?? doc.total ?? null,
    currency: doc.currency ?? null,
    cartCount: doc.cart_count ?? doc.quantity ?? null,
    productId: doc.product_id ?? null,
    linkedQuery: doc.search_query ?? null,
    url: doc.intercept_url ?? doc.product_url ?? null,
  });
}
cartDocs.forEach(x => capture(x, "cart"));
checkoutDocs.forEach(x => capture(x, "checkout"));
events.sort((a, b) => a.eventTime - b.eventTime);

const grouped = new Map();
for (const e of events) {
  if (!grouped.has(e.sessionId)) grouped.set(e.sessionId, []);
  grouped.get(e.sessionId).push(e);
}
const sessionRows = [...grouped].map(([sessionId, es]) => {
  const first = es[0];
  const carts = es.filter(e => e.type === "cart");
  const checks = es.filter(e => e.type === "checkout");
  const knownValues = es.map(e => e.value).filter(v => v !== null && v !== undefined);
  return [
    first.zeroQuery, first.zeroTime, carts[0]?.eventTime ?? null, checks[0]?.eventTime ?? null,
    carts.length && checks.length ? "Cart + checkout" : carts.length ? "Cart" : "Checkout",
    knownValues.length ? Math.max(...knownValues.map(Number)) : "Not sent",
    es.length, sessionId,
  ];
}).sort((a, b) => a[1] - b[1]);

const eventRows = events.map(e => [
  e.zeroQuery, e.zeroTime, e.eventTime, e.type, e.minutes,
  e.value ?? "Not sent", e.currency ?? "", e.cartCount, e.productId, e.linkedQuery, e.url, e.sessionId,
]);

const wb = Workbook.create();
const summary = wb.worksheets.add("Summary");
const sessions = wb.worksheets.add("Conversions");
const detail = wb.worksheets.add("Event detail");
for (const s of [summary, sessions, detail]) s.showGridLines = false;
summary.getRange("A1:D1").merge();
summary.getRange("A1").values = [["Steimatzky — zero-results conversion list"]];
summary.getRange("A3:B9").values = [
  ["Metric", "Value"], ["Unique sessions", sessionRows.length], ["Event rows", eventRows.length],
  ["Cart events", events.filter(e => e.type === "cart").length], ["Checkout events", events.filter(e => e.type === "checkout").length],
  ["Events with recorded cart value", events.filter(e => e.value != null).length], ["Snapshot (UTC)", asOf],
];
summary.getRange("A11:D11").values = [["Important", "Cart value was not sent in any qualifying event.", "Attribution window", "2 hours after zero-results"]];
sessions.getRangeByIndexes(0, 0, sessionRows.length + 1, 8).values = [["Zero-result query", "Zero time (UTC)", "First cart time (UTC)", "First checkout time (UTC)", "Reached", "Cart value", "Tracked events", "Session ID"], ...sessionRows];
detail.getRangeByIndexes(0, 0, eventRows.length + 1, 12).values = [["Zero-result query", "Zero time (UTC)", "Event time (UTC)", "Event type", "Minutes after zero", "Cart value", "Currency", "Cart count / quantity", "Product ID", "Event search query", "URL", "Session ID"], ...eventRows];
const head = { fill: "#17324D", font: { bold: true, color: "#FFFFFF" } };
summary.getRange("A1:D1").format = { fill: "#0B6E69", font: { bold: true, color: "#FFFFFF", size: 16 } };
summary.getRange("A1:D1").format.rowHeight = 30;
summary.getRange("A3:B3").format = head;
summary.getRange("A11:D11").format = { fill: "#FFF4CC", font: { bold: true, color: "#7A4E00" }, wrapText: true };
summary.getRange("A1:D11").format.autofitColumns();
summary.getRange("A:D").format.columnWidth = 31;
summary.getRange("B9").format.numberFormat = "yyyy-mm-dd hh:mm:ss";
for (const [sheet, cols, rows] of [[sessions, 8, sessionRows.length], [detail, 12, eventRows.length]]) {
  sheet.getRangeByIndexes(0, 0, 1, cols).format = head;
  sheet.freezePanes.freezeRows(1);
  sheet.getRangeByIndexes(0, 0, rows + 1, cols).format.autofitColumns();
  sheet.getRangeByIndexes(0, 0, rows + 1, cols).format.borders = { insideHorizontal: { style: "thin", color: "#E4E7EB" } };
}
sessions.getRange(`B2:D${sessionRows.length + 1}`).format.numberFormat = "yyyy-mm-dd hh:mm:ss";
sessions.getRange("A:A").format.columnWidth = 36;
sessions.getRange("B:D").format.columnWidth = 22;
sessions.getRange("H:H").format.columnWidth = 32;
detail.getRange(`B2:C${eventRows.length + 1}`).format.numberFormat = "yyyy-mm-dd hh:mm:ss";
detail.getRange("A:A").format.columnWidth = 34;
detail.getRange("B:C").format.columnWidth = 22;
detail.getRange("J:L").format.columnWidth = 32;
sessions.tables.add(`A1:H${sessionRows.length + 1}`, true, "ConversionsTable");
detail.tables.add(`A1:L${eventRows.length + 1}`, true, "EventDetailTable");
await fs.mkdir(outputDir, { recursive: true });
const preview = await wb.render({ sheetName: "Summary", range: "A1:D11", scale: 1.5, format: "png" });
await fs.writeFile(`${outputDir}/summary-preview.png`, new Uint8Array(await preview.arrayBuffer()));
console.log((await wb.inspect({ kind: "table", range: "Summary!A1:D11", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 4 })).ndjson);
console.log((await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula error scan" })).ndjson);
const file = await SpreadsheetFile.exportXlsx(wb);
await file.save(`${outputDir}/zero_result_query_time_cart_value.xlsx`);
