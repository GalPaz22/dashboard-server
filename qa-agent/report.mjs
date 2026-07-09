// Writes the QA run out as a human-readable Markdown report (Hebrew) plus a
// machine-readable report.json that apply.mjs consumes. Each proposed fix gets a
// stable id and starts as approved:null (pending your review).
import fs from "fs";
import path from "path";
import { config } from "./config.mjs";

const LEVER_HE = {
  context_rule: "כלל הקשר (NL)",
  product_retag: "תיוג מחדש של מוצר",
  config_change: "שינוי קונפיג",
  algorithm: "שינוי אלגוריתם (ידני)",
};
const VERDICT_HE = { good: "טוב", mediocre: "בינוני", bad: "רע", unknown: "לא ידוע" };

export function makeRunDir() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(config.reportsDir, ts);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, ts };
}

/**
 * @param storeReports Array<{ store, cases: Array<{query,source,result,grade,diagnosis?}> }>
 */
export function writeReport(dir, storeReports) {
  const fixes = [];
  let fixSeq = 0;

  for (const sr of storeReports) {
    for (const c of sr.cases) {
      if (!c.diagnosis || !c.diagnosis.lever) continue;
      const id = `${sr.store.dbName}-${String(++fixSeq).padStart(3, "0")}`;
      fixes.push({
        id,
        store: sr.store.dbName,
        apiKey: sr.store.apiKey, // needed by apply.mjs to target users.users
        query: c.query,
        verdict: c.grade?.verdict,
        score: c.grade?.score ?? null,
        rootCause: c.diagnosis.rootCause,
        lever: c.diagnosis.lever,
        fix: c.diagnosis.fix,
        confidence: c.diagnosis.confidence ?? null,
        expectedImpact: c.diagnosis.expectedImpact || null,
        approved: null,
        applied: false,
      });
    }
  }

  const json = {
    generatedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    models: config.models,
    stores: storeReports.map((sr) => ({
      dbName: sr.store.dbName,
      name: sr.store.name,
      tested: sr.cases.length,
      good: sr.cases.filter((c) => c.grade?.verdict === "good").length,
      mediocre: sr.cases.filter((c) => c.grade?.verdict === "mediocre").length,
      bad: sr.cases.filter((c) => c.grade?.verdict === "bad").length,
    })),
    fixes,
  };
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(json, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "report.md"), renderMarkdown(json, storeReports), "utf8");
  return json;
}

function renderMarkdown(json, storeReports) {
  const L = [];
  L.push(`# דוח QA חיפוש — ${json.generatedAt}`);
  L.push("");
  L.push(`נבדקו ${json.stores.length} לקוחות דרך \`${json.baseUrl}\`. מודל שיפוט: \`${json.models.grade}\`, מודל אבחון: \`${json.models.diagnose}\`.`);
  L.push("");
  L.push("## סיכום פר-לקוח");
  L.push("");
  L.push("| לקוח | נבדקו | טוב | בינוני | רע | תיקונים מוצעים |");
  L.push("|------|-------|-----|--------|----|----------------|");
  for (const s of json.stores) {
    const nFix = json.fixes.filter((f) => f.store === s.dbName).length;
    L.push(`| ${s.dbName} | ${s.tested} | ${s.good} | ${s.mediocre} | ${s.bad} | ${nFix} |`);
  }
  L.push("");

  for (const sr of storeReports) {
    const storeFixes = json.fixes.filter((f) => f.store === sr.store.dbName);
    L.push(`## ${sr.store.dbName}${sr.store.name && sr.store.name !== sr.store.dbName ? ` (${sr.store.name})` : ""}`);
    L.push("");

    // Failing/mediocre queries with their diagnoses.
    const flagged = sr.cases.filter((c) => c.grade?.verdict === "bad" || c.grade?.verdict === "mediocre");
    if (!flagged.length) {
      L.push("_כל השאילתות שנבדקו קיבלו ציון טוב._");
      L.push("");
      continue;
    }
    for (const c of flagged) {
      L.push(`### 🔎 \`${c.query}\` — ${VERDICT_HE[c.grade?.verdict] || c.grade?.verdict} (${c.grade?.score ?? "?"})  ·  מקור: ${c.source}`);
      L.push(`- **כוונה שזוהתה:** ${c.grade?.inferredIntent || "—"}`);
      if (c.grade?.issues?.length) L.push(`- **בעיות:** ${c.grade.issues.join("; ")}`);
      const top = (c.result?.products || []).slice(0, 5).map((p) => `${p.name}${p.category ? ` [${p.category}]` : ""}`).join(" · ");
      L.push(`- **הוחזר (top5):** ${top || "—"}`);
      const fx = storeFixes.find((f) => f.query === c.query);
      if (fx) {
        L.push(`- **🩺 סיבת שורש:** ${fx.rootCause}`);
        L.push(`- **🔧 תיקון מוצע (\`${fx.id}\`, מנוף: ${LEVER_HE[fx.lever] || fx.lever}, ביטחון: ${fx.confidence ?? "?"}):**`);
        L.push("");
        L.push("  ```json");
        L.push("  " + JSON.stringify(fx.fix, null, 2).split("\n").join("\n  "));
        L.push("  ```");
        if (fx.expectedImpact) L.push(`  - _השפעה צפויה:_ ${fx.expectedImpact}`);
      }
      L.push("");
    }
  }

  L.push("---");
  L.push("## אישור והחלה");
  L.push("סמן תיקונים לאישור ב-`report.json` (`approved: true`) או השתמש בדגל `--approve`.");
  L.push("");
  L.push("```bash");
  L.push(`node qa-agent/apply.mjs "${path.join("qa-agent", "reports")}/.../report.json" --approve <id1,id2> --commit`);
  L.push("```");
  L.push("");
  L.push("> תיקוני `algorithm` אינם מוחלים אוטומטית — הם מסומנים לטיפול ידני ב-server.js.");
  return L.join("\n");
}
