import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { MongoClient } from "/Users/galpaz/Desktop/dashboard-server/node_modules/mongodb/lib/index.js";

process.on("uncaughtException", error => { console.error(`ERR: ${error.message}`); process.exit(1); });
process.on("unhandledRejection", error => { console.error(`ERR: ${error?.message || error}`); process.exit(1); });

const cutoff = new Date("2026-08-29T13:49:06.194Z");
const outputDir = "/Users/galpaz/Desktop/dashboard-server/outputs/steimatzky-zero-to-cart";
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

await client.connect();
const db = client.db("steimatzky");

const zeroDocs = await db.collection("zero_searches")
  .find({ first_seen: { $lte: cutoff } })
  .project({ session_id: 1, query: 1, first_seen: 1, last_seen: 1, recovered_count: 1 })
  .toArray();

const zeroBySession = new Map();
for (const row of zeroDocs) {
  const time = new Date(row.first_seen);
  if (!zeroBySession.has(row.session_id)) zeroBySession.set(row.session_id, { first: time, rows: [] });
  const entry = zeroBySession.get(row.session_id);
  if (time < entry.first) entry.first = time;
  entry.rows.push(row);
}

const cartDocs = await db.collection("cart")
  .find({ session_id: { $in: [...zeroBySession.keys()] } })
  .project({ session_id: 1, timestamp: 1, created_at: 1, search_query: 1, product_id: 1, product_name: 1 })
  .toArray();

const cartsBySession = new Map();
for (const row of cartDocs) {
  const time = new Date(row.timestamp || row.created_at);
  const zero = zeroBySession.get(row.session_id);
  if (!zero || time > cutoff || time < zero.first) continue;
  if (!cartsBySession.has(row.session_id)) cartsBySession.set(row.session_id, []);
  cartsBySession.get(row.session_id).push({ ...row, time });
}

const sessionIds = [...cartsBySession.keys()];
const queryDocs = await db.collection("queries")
  .find({ session_id: { $in: sessionIds }, timestamp: { $lte: cutoff } })
  .project({ session_id: 1, query: 1, timestamp: 1, deliveredProducts: 1 })
  .sort({ timestamp: 1 })
  .toArray();
await client.close();

const allRows = [];
const seenZero = new Set();
for (const row of queryDocs) {
  const zeroRows = zeroBySession.get(row.session_id).rows;
  const normalized = String(row.query || "").trim().toLowerCase();
  const matchedZero = zeroRows.find(z => String(z.query || "").trim().toLowerCase() === normalized);
  if (matchedZero) seenZero.add(`${row.session_id}\u0000${normalized}`);
  allRows.push([
    new Date(row.timestamp), row.session_id, String(row.query || ""), Boolean(matchedZero),
    Array.isArray(row.deliveredProducts) ? row.deliveredProducts.length : null,
    matchedZero?.recovered_count ?? null,
    new Date(row.timestamp) >= zeroBySession.get(row.session_id).first ? "After/at first zero" : "Before first zero",
    "queries"
  ]);
}
for (const sessionId of sessionIds) {
  for (const z of zeroBySession.get(sessionId).rows) {
    const normalized = String(z.query || "").trim().toLowerCase();
    if (seenZero.has(`${sessionId}\u0000${normalized}`)) continue;
    allRows.push([new Date(z.first_seen), sessionId, z.query, true, null, z.recovered_count ?? null, "After/at first zero", "zero_searches only"]);
  }
}
allRows.sort((a, b) => a[0] - b[0]);

const sessionRows = sessionIds.map(sessionId => {
  const zero = zeroBySession.get(sessionId);
  const carts = cartsBySession.get(sessionId).sort((a, b) => a.time - b.time);
  const qs = allRows.filter(r => r[1] === sessionId);
  return [
    sessionId, zero.first, qs.length, new Set(qs.map(r => String(r[2]).trim().toLowerCase())).size,
    zero.rows.length, carts.length, carts[0].time, carts.at(-1).time,
    [...new Set(zero.rows.map(r => r.query))].join(" | "),
    [...new Set(carts.map(r => r.search_query).filter(Boolean))].join(" | ")
  ];
}).sort((a, b) => a[1] - b[1]);

const frequency = new Map();
for (const row of allRows) {
  const norm = String(row[2]).trim().toLowerCase();
  if (!frequency.has(norm)) frequency.set(norm, { query: row[2], events: 0, sessions: new Set(), zero: false });
  const item = frequency.get(norm);
  item.events += 1;
  item.sessions.add(row[1]);
  item.zero ||= row[3];
}
const frequencyRows = [...frequency.values()]
  .map(x => [x.query, x.events, x.sessions.size, x.zero])
  .sort((a, b) => b[2] - a[2] || b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "he"));

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const queries = workbook.worksheets.add("All queries");
const sessions = workbook.worksheets.add("Sessions");
const freq = workbook.worksheets.add("Query frequency");
for (const sheet of [summary, queries, sessions, freq]) sheet.showGridLines = false;

summary.getRange("A1:D1").merge();
summary.getRange("A1").values = [["Steimatzky — Zero-results → Cart query audit"]];
summary.getRange("A3:B8").values = [
  ["Metric", "Value"],
  ["Qualified sessions", sessionIds.length],
  ["Query events", allRows.length],
  ["Unique normalized queries", frequencyRows.length],
  ["Zero-result query rows", allRows.filter(r => r[3]).length],
  ["Data cutoff (UTC)", cutoff],
];
summary.getRange("A10:D10").values = [["Notes", "Definition", "Source DB", "Collections"]];
summary.getRange("A11:D11").values = [[
  "One row per logged search; use filters to trace each shopper journey.",
  "A session has a zero_searches event followed chronologically by an add_to_cart event.",
  "steimatzky",
  "queries, zero_searches, cart"
]];

queries.getRangeByIndexes(0, 0, allRows.length + 1, 8).values = [["Timestamp (UTC)", "Session ID", "Query", "Zero result", "Delivered products", "Recovered count", "Position vs first zero", "Source"], ...allRows];
sessions.getRangeByIndexes(0, 0, sessionRows.length + 1, 10).values = [["Session ID", "First zero (UTC)", "Query events", "Unique queries", "Zero queries", "Cart events", "First cart (UTC)", "Last cart (UTC)", "Zero-result queries", "Cart-linked queries"], ...sessionRows];
freq.getRangeByIndexes(0, 0, frequencyRows.length + 1, 4).values = [["Query", "Events", "Sessions", "Was zero-result"], ...frequencyRows];

const headerStyle = { fill: "#17324D", font: { bold: true, color: "#FFFFFF" }, verticalAlignment: "center" };
summary.getRange("A1:D1").format = { fill: "#0B6E69", font: { bold: true, color: "#FFFFFF", size: 16 }, verticalAlignment: "center" };
summary.getRange("A1:D1").format.rowHeight = 30;
summary.getRange("A3:B3").format = headerStyle;
summary.getRange("A10:D10").format = headerStyle;
summary.getRange("A11:D11").format.wrapText = true;
summary.getRange("A11:D11").format.rowHeight = 48;
summary.getRange("A1:D11").format.autofitColumns();
summary.getRange("A:A").format.columnWidth = 34;
summary.getRange("B:D").format.columnWidth = 28;
summary.getRange("B8").format.numberFormat = "yyyy-mm-dd hh:mm:ss";

for (const [sheet, cols, rows] of [[queries, 8, allRows.length], [sessions, 10, sessionRows.length], [freq, 4, frequencyRows.length]]) {
  sheet.getRangeByIndexes(0, 0, 1, cols).format = headerStyle;
  sheet.freezePanes.freezeRows(1);
  sheet.getRangeByIndexes(0, 0, rows + 1, cols).format.autofitColumns();
  sheet.getRangeByIndexes(0, 0, rows + 1, cols).format.borders = { insideHorizontal: { style: "thin", color: "#E4E7EB" } };
}
queries.freezePanes.freezeColumns(2);
queries.getRange(`A2:A${allRows.length + 1}`).format.numberFormat = "yyyy-mm-dd hh:mm:ss";
queries.getRange(`D2:D${allRows.length + 1}`).conditionalFormats.add("containsText", { text: "TRUE", format: { fill: "#FDE8E7", font: { color: "#9B1C1C", bold: true } } });
queries.getRange("A:A").format.columnWidth = 21;
queries.getRange("B:B").format.columnWidth = 31;
queries.getRange("C:C").format.columnWidth = 38;
queries.getRange("G:H").format.columnWidth = 22;
sessions.getRange(`B2:B${sessionRows.length + 1}`).format.numberFormat = "yyyy-mm-dd hh:mm:ss";
sessions.getRange(`G2:H${sessionRows.length + 1}`).format.numberFormat = "yyyy-mm-dd hh:mm:ss";
sessions.getRange("A:A").format.columnWidth = 31;
sessions.getRange("I:J").format.columnWidth = 45;
sessions.getRange("I:J").format.wrapText = true;
freq.getRange("A:A").format.columnWidth = 42;

queries.tables.add(`A1:H${allRows.length + 1}`, true, "AllQueriesTable");
sessions.tables.add(`A1:J${sessionRows.length + 1}`, true, "SessionsTable");
freq.tables.add(`A1:D${frequencyRows.length + 1}`, true, "QueryFrequencyTable");

await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({ sheetName: "Summary", range: "A1:D11", scale: 1.5, format: "png" });
await fs.writeFile(`${outputDir}/summary-preview.png`, new Uint8Array(await preview.arrayBuffer()));
console.log((await workbook.inspect({ kind: "table", range: "Summary!A1:D11", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 4 })).ndjson);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula error scan" })).ndjson);
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/steimatzky_zero_to_cart_queries.xlsx`);
