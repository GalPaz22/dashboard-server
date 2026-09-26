# Handoff — Search Engine: Root Cause and Target Architecture

Written 2026-09-11. Read this before `SEARCH_PIPELINE_REDESIGN.md`, which it supersedes on
priorities and extends on scope.

---

## 0. What the owner wants

Two things, in this order.

**A. Search that isn't wrong.** The merchant's words: *"זה המהות של המנוע שלנו"* — searching
"לק סגול" must return purple nail polish, not every product with "purple" written somewhere.

**B. A server that adapts itself to the client.** A rug store and an electronics store should
not share an index definition, a product schema, or the same notion of what a query means.
The target is a **shared core plus a per-client layer**: one pipeline, whose vocabulary,
schema, index shape, and tuning are supplied per store rather than compiled in.

These are the same project. The reason (A) keeps failing is that the pipeline has one global
notion of relevance, so every fix for one vertical is a regression risk for another — which is
exactly what (B) is meant to solve.

---

## 1. The root cause

**The engine has no concept of "no good answer."**

Measured over 899 real shopper queries from 15 live stores (see §5 for how):

| Observation | Value |
|---|---|
| Queries returning **zero** results | **0 of 899** |
| Queries returning exactly 75 (`MAX_FILTER_MATCH_RESULTS`) | 72 |
| Queries returning exactly 25 (the `$limit: 25` caps) | 179 |
| So: searches that stopped at a cap rather than running out of matches | **29%** |

Every branch asks Mongo for N products and returns N products. There is no point anywhere in
the pipeline where a product is rejected for being a bad match. The branch that answers 46% of
all traffic is the clearest example:

```14751:14754:server.js
        const engSearchPipeline = [
          { $search: { index: "default", compound: { must: mustClauses, filter: engFilterClauses } } },
          { $limit: 25 }
        ];
```

No score threshold, no sort, and the very next line short-circuits with
`⚡ QUICK ENGLISH SEARCH ... returning without full search`. If three products genuinely match,
the shopper gets three good ones and twenty-two arbitrary ones. `MAX_FILTER_MATCH_RESULTS = 75`
(line 11117) does the same thing in the filter branch — beautics `לק` → 75, `בייס` → 75,
`שמן` → 75, `ראש` → 75. That is not an answer to a query, it is the whole aisle.

**This is why the recent bug fixes felt like whack-a-mole.** "strong" returning nail polish and
"לק סגול" returning purple bedsheets (both fixed in [PR #166](https://github.com/GalPaz22/dashboard-server/pull/166),
merged) were not two bugs. They were one root cause surfacing through two branches. Two
symptoms are fixed; the root is untouched.

**Corollary — a tiered pipeline cannot work until this is fixed.** The four-tier design in
`SEARCH_PIPELINE_REDESIGN.md` depends on a tier being able to say *"I found nothing, pass it
down."* No tier can currently say that. Reordering the tiers without adding a relevance
threshold just rearranges the same failure.

### Second finding: the LLM is the default path, not the fallback

| Branch | Share of the 899 queries |
|---|---|
| `translated-text-match` | **46.6%** |
| `perfect-filter-match` | 24.9% |
| `exact-text-match` | 8.7% |
| `llm-catalog-expansion` | 6.7% |
| `out-of-stock-name-match` | 4.2% |
| 10 other modes | < 3% each |

**361 of the 408 translated queries were pure Hebrew searching a Hebrew catalog.** `רקנאטי`,
`ריזלינג`, `שאבלי` — Hebrew brand names present verbatim in the catalog — were sent on an
English round trip to find themselves. Meanwhile the literal path that should have caught them
fires on 8.7% of traffic. Tier 1 in the target design is effectively dead code today.

This costs latency, money, and determinism on nearly half of all searches.

### Third finding: 26 queries return HTTP 500 in production

Real shopper queries in **cheers, redCarpet, GAL2, danon, dizzy** hard-fail with
`Path 'stockStatus' needs to be indexed as filter` and
`autocomplete index field definition not present at path category`. These are per-store Atlas
index definitions that omit a path the pipeline queries.

A fix is **already in the working tree, uncommitted** (§4): `isAtlasSearchIndexUnavailable`
recognised an index that is *unavailable* but not one that is *partially defined*, so the error
escaped to a 500 instead of falling back. Verified to bring those stores to 0 errors.

Note what this says about goal (B): the pipeline assumes an index shape that not every client
has. That is a per-client schema problem wearing a 500 as a costume.

---

## 2. The per-client layer

### The seam already exists

`getStoreConfigByApiKey` (line 3025) resolves an `X-API-Key` to a per-store config and is the
natural home for the flexible layer. It already carries ~18 per-store fields:

`products`, `queries`, `categories`, `types`, `softCategories`, `softCategoriesBoost`,
`syncMode`, `limit`, `context`, `colors`, `pinnedResults`, `showOutOfStock`, `hebrewTranslate`,
`searchAuthor`, `enableSimpleCategoryExtraction`, `firstMatchCategory`,
`filterExtractionSystemInstruction`, plus the concierge settings.

Two things are worth noticing:

- **`limit: userDoc.limit || 25` (line 3066).** The cap in §1 is *already* per-store
  configurable and simply defaults to 25 everywhere. The mechanism for per-client tuning is
  half-built.
- **The existing comment on `context` states the right principle** and should govern the whole
  layer: *"Never infer a store vertical here: a missing value must stay open-ended rather than
  quietly turning every merchant into a wine store."*

`searchAuthor` is the working precedent for a per-vertical branch: steimatzky (books) answers
20% of its traffic through `author-match`, a branch that never fires for garmin.

### Verticals demonstrably behave differently

Top branches per store, from the same 899-query run:

| Store | Vertical | Dominant branches |
|---|---|---|
| redCarpet | rugs | `llm-catalog-expansion` 65%, `translated-text-match` 33% |
| steimatzky | books | `translated-text-match` 23%, `author-match` 20%, `out-of-stock-name-match` 17% |
| refaeli | — | `perfect-filter-match` 53%, `out-of-stock-name-match` 15% |
| manoVino | wine | `perfect-filter-match` 48%, `translated-text-match` 35% |
| dizzy | — | `translated-text-match` 76%, `exact-text-match` 22% |
| garmin | electronics | `translated-text-match` 43%, `perfect-filter-match` 33%, `simple-high-confidence` 15% |
| beautics | nail supplies | `translated-text-match` 55%, `perfect-filter-match` 35% |

Average results returned per query ranges from **9.2 (redCarpet)** to **35.6 (beautics)** — a
4× spread that nobody chose. redCarpet's 65% `llm-catalog-expansion` says its shoppers write
sentences ("שטיח עגול בצבע בהיר שיתאים למרפסת") while garmin's shoppers write model numbers
("Forerunner 265"). One global pipeline is currently serving both.

### What belongs in the per-client layer

Candidates, in rough order of value:

1. **Relevance threshold and result cap** — what "good enough to show" means. A rug store with
   400 SKUs and an electronics store with 40 model numbers need different answers.
2. **Index and schema contract** — which paths exist and are indexed, declared per store and
   validated, so a missing `stockStatus` filter degrades by design instead of throwing.
3. **Query-shape expectation** — model-number store vs. natural-language store. This decides
   whether tier 1 or tier 4 is the likely answer and lets the pipeline stop guessing.
4. **Vocabulary** — stopwords, accessory keywords, head-word→category mappings. Today
   `CATALOG_STOPWORDS` (line 580) and `ACCESSORY_KEYWORDS` (line 1042) are global constants
   shared by a wine store and a nail-supply store.
5. **Which tiers are enabled at all** — the per-store flag that the four-tier rollout needs
   anyway.

The bulk of hardcoded vertical vocabulary is thankfully small (grep found ~36 occurrences of
`יין` and a handful of others), so the work is structural rather than a mass find-and-replace.

---

## 3. Constraints from the owner — read these before running anything

- **Do not run mass evaluations against live customer stores.** Several stores in the corpus
  are inactive customers. Scope work to **beautics** unless told otherwise.
- **Do not burn LLM calls at scale.** A full 3-pass corpus run is ~2,700 LLM-touching requests.
  This was done once; the snapshots are on disk (§5) and should be mined offline instead of
  re-run.
- Prefer a hand-curated list of 10–15 beautics queries with known-correct answers over
  statistical sweeps.

---

## 4. Repository state

Branch `codex/gemini-concierge-search`. [PR #166](https://github.com/GalPaz22/dashboard-server/pull/166) is **merged**
(the "strong" and colour fixes).

**Uncommitted:**

| Path | State | What it is |
|---|---|---|
| `server.js` | modified | The `isAtlasSearchIndexUnavailable` fix from §1 (~line 264). Verified, not committed. |
| `.gitignore` | modified | Ignores `eval/snapshots/`. |
| `SEARCH_PIPELINE_REDESIGN.md` | untracked | The four-tier plan: current-state map, branch-by-branch keep/merge/delete table with line numbers, staging plan. Still accurate; re-prioritise per §1. |
| `eval/` | untracked | Harness, corpus, snapshots (§5). |

---

## 5. The measurement harness

Built because the pipeline is non-deterministic, so a naive before/after diff cannot separate a
regression from noise.

```
node eval/search-eval.mjs pull  [--per-store 150] [--min-traffic 200]
eval/pass.sh <label-prefix> <passes> [--stores a,b] [--limit N] [--concurrency 6]
node eval/search-eval.mjs diff  base1,base2,base3  after1,after2,after3
```

`eval/pass.sh` starts a **fresh server per pass**, which matters: the variance is per process,
not per call. Repeating a query inside one server process reports 0 unstable; running three
separate processes reports 6 of 60 on garmin. The harness was self-tested by diffing a build
against itself — 0 changed, noise correctly isolated.

API keys are resolved from Mongo at runtime and are deliberately **never** written to
`eval/corpus.json`.

### The measured noise floor

**151 of 899 queries (17%) are unstable across passes with no code change at all.**

| What varies | Count |
|---|---|
| Same mode and count, different products or order | 110 |
| Same mode, different result count | 22 |
| The `searchMode` branch itself flips | 19 |

By branch: `llm-catalog-expansion` 63% unstable, `translated-catalog-match` 50%,
`perfect-filter-match` **25%**, `translated-text-match` 8%.

Two things follow. First, any future change reporting "150 queries changed" may be reporting
nothing. Second — **`perfect-filter-match` being 25% unstable is itself a bug worth chasing.**
Filters should be deterministic. The largest bucket (110 queries, same mode and same count,
only the products or their order differ) points at Atlas `$search` returning tied scores in
arbitrary order with no tiebreaker sort. That is likely a cheap fix that would both improve
perceived quality and cut the noise floor enough to make everything else measurable.

### Artifacts on disk

- `eval/corpus.json` — 899 queries across 15 stores, frequency-ordered from each store's
  `queries` collection. Committed-safe (no keys).
- `eval/snapshots/base1..3.json` — the three baseline passes. **Gitignored, and the only copy.
  Do not delete: they cost 2,700 LLM calls and the owner does not want them re-run.**

Each snapshot record is `{store, query, mode, count, ids}` where `ids` is the top 10 product
ids. Mine these offline for anything else you need; §1 and §2 were derived entirely this way,
at zero cost.

---

## 6. Recommended sequence

1. **Commit the 500 fix** in `server.js`. It is verified and independent of everything else.
2. **Add a tiebreaker sort** to the `$search` pipelines and re-check the noise floor against the
   existing baseline. Cheap, and it makes every later change measurable.
3. **Introduce a relevance threshold** — the root cause in §1 — behind a per-store setting,
   enabled for beautics only. This is where "no good answer" becomes expressible. Validate
   against a hand-curated beautics list, not a sweep.
4. **Then** the four-tier reordering from `SEARCH_PIPELINE_REDESIGN.md`, which becomes tractable
   once tiers can decline.
5. **Then** lift threshold, cap, vocabulary, and schema contract into the per-client layer at
   `getStoreConfigByApiKey`, one field at a time, defaulting to today's behaviour so no store
   moves until its config says so.

Steps 1–3 are the ones that change what shoppers see. Steps 4–5 are what stop the next fix from
breaking a different vertical.
