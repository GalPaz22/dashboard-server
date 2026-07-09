// The QA "brain". Two model steps, both fully domain-agnostic — every piece of
// domain knowledge is passed in from the store's own config/data, never hardcoded.
//
//   grade()          — cheap+fast, per query: are the results good for the intent?
//   diagnoseAndFix() — strong model, only for failures: WHY, and the ROOT-CAUSE fix
//                      mapped to one of four universal levers.
import { complete, extractJson } from "./anthropic.mjs";
import { config } from "./config.mjs";
import { storeTaxonomy } from "./stores.mjs";
import { probeCandidates } from "./probe.mjs";

const GRADE_SYSTEM = `You are a meticulous e-commerce search-quality evaluator. You work across ANY product domain (wine, electronics, jewelry, fashion, groceries…). You are given a store's business context and its own category vocabulary, a shopper's search query, and the products the search engine returned.

Your job:
1. Infer the shopper's INTENT from the query, using the store's business context to disambiguate. (e.g. in a drinks store "bourbon" means whiskey, NOT wine; "red" likely means a color/attribute.)
2. Judge whether the returned products actually satisfy that intent and are well-ordered (best match first).
3. Be strict about category mismatches (right intent, wrong product type) and about relevant items that are missing or buried.

Do NOT invent rules about specific keywords. Judge only from the intent and the products shown.

Return ONLY a JSON object:
{
  "verdict": "good" | "mediocre" | "bad",
  "score": 0-100,
  "inferredIntent": "short phrase",
  "topMatchRelevant": true|false,
  "issues": ["concise issue", ...],
  "reasoning": "1-3 sentences"
}
"good" = results clearly satisfy intent and top item is relevant. "bad" = wrong category/intent or empty/irrelevant. "mediocre" = partially relevant, poor ordering, or thin.`;

const DIAGNOSE_SYSTEM = `You are a senior search-relevance engineer fixing an e-commerce search engine. You work across ANY product domain. A specific query returned poor results. You must find the ROOT CAUSE and propose ONE universal, durable fix — never a per-query keyword hack or a hardcoded synonym list.

You are given: the store's business context, its category vocabulary, the failing query, the (bad) returned products, and candidate products that plausibly should have matched (pulled directly from the catalog by text).

Choose exactly ONE fix lever:
- "context_rule": append a natural-language instruction to the store's LLM steering context (this text is fed to the query translator, complexity classifier, and reranker). Use for intent/translation/category-extraction rules. Must be general (about a concept), e.g. "Treat searches for spirit types (bourbon, scotch, rye) as the whiskey category, not wine." Provide "appendText".
- "product_retag": specific catalog products are mis-tagged (wrong category/type/softCategory) and that causes the failure. Provide "products": [{ "id", "name", "set": { "category"?, "type"?, "softCategory"? }, "from": {...current...} }].
- "config_change": the store's taxonomy is missing or mis-weighted a category. Provide "field" (one of softCategories, categories, type, colors, softCategoryBoosts), "op" ("add" | "remove" | "setBoost"), and "value".
- "algorithm": the flaw is in the search ranking/matching code itself and cannot be fixed via config. Provide "description" of the code change. (This will be flagged for a human, NOT auto-applied.)

Prefer context_rule or product_retag when they address the true root cause. Only choose config_change when a genuinely relevant category is absent from the taxonomy. Only choose algorithm as a last resort.

Return ONLY JSON:
{
  "rootCause": "1-2 sentences on the underlying cause",
  "lever": "context_rule" | "product_retag" | "config_change" | "algorithm",
  "fix": { ...lever-specific fields... },
  "confidence": 0.0-1.0,
  "expectedImpact": "what improves, and roughly how broadly"
}`;

function compact(products) {
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    type: p.type,
    softCategory: p.softCategory,
  }));
}

export async function grade(store, testCase, searchResult) {
  const tax = storeTaxonomy(store);
  const payload = {
    businessContext: tax.context || "(none provided)",
    categoryVocabulary: { categories: tax.categories, types: tax.types, softCategories: tax.softCategories, colors: tax.colors },
    query: testCase.query,
    querySource: testCase.source,
    returnedProducts: compact(searchResult.products),
    returnedCount: searchResult.count,
  };
  const text = await complete({
    model: config.models.grade,
    system: GRADE_SYSTEM,
    maxTokens: 700,
    messages: [{ role: "user", content: "Evaluate this search:\n" + JSON.stringify(payload, null, 2) }],
  });
  const parsed = extractJson(text);
  if (!parsed || !parsed.verdict) {
    return { verdict: "unknown", score: null, issues: ["grader returned unparseable output"], reasoning: (text || "").slice(0, 200) };
  }
  return parsed;
}

export async function diagnoseAndFix(store, testCase, searchResult, gradeResult) {
  const tax = storeTaxonomy(store);
  const candidates = await probeCandidates(store, testCase.query).catch(() => []);
  const payload = {
    businessContext: tax.context || "(none provided)",
    categoryVocabulary: { categories: tax.categories, types: tax.types, softCategories: tax.softCategories, colors: tax.colors },
    failingQuery: testCase.query,
    grader: { verdict: gradeResult.verdict, inferredIntent: gradeResult.inferredIntent, issues: gradeResult.issues },
    returnedProducts: compact(searchResult.products),
    candidateProductsFromCatalog: candidates,
  };
  const text = await complete({
    model: config.models.diagnose,
    system: DIAGNOSE_SYSTEM,
    maxTokens: 1600,
    messages: [{ role: "user", content: "Diagnose and propose one root-cause fix:\n" + JSON.stringify(payload, null, 2) }],
  });
  const parsed = extractJson(text);
  if (!parsed || !parsed.lever) {
    return { rootCause: "diagnoser returned unparseable output", lever: null, fix: null, confidence: 0, raw: (text || "").slice(0, 300) };
  }
  return parsed;
}
