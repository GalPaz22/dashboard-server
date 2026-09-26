# Search Pipeline Redesign — Four Tiers

Status: **plan only, nothing implemented.**

Goal: replace the current search pipeline with four explicit, ordered tiers.

1. **Literal match** — the shopper named a specific product or brand.
2. **Filter match** — the shopper described an aisle (category, colour, price).
3. **Translation + close textual match** — the words are right but the catalog spells them differently, often in the other language.
4. **Vector search + a catalog-wide AI pass** using the store's context.

Each tier answers the query or hands it down. Nothing below a tier runs once that tier has answered.

---

## 1. Where we are today

The four tiers already exist in the code. They are interleaved rather than ordered, spread across two functions:

| Function | Lines | Size |
|---|---|---|
| `_performSimpleSearchInner` | 11113–11905 | 793 |
| `app.post("/search")` | 13560–17327 | 3,768 |

Seventeen retrieval helpers feed them, and roughly thirty distinct `metadata.searchMode` values can reach the client.

### The ordering is partly inverted

`detectPerfectFilterMatch` runs first, at line 11122. When it reports a perfect match, **all fourteen textual branches are skipped entirely** (the whole block at 11133–11423 is wrapped in `if (!isPerfectFilterMatch)`). Filters currently pre-empt literal matching, which is the opposite of the intended order.

### Everything is attempted more than once

- **Translation** happens in at least five places: three inside `_performSimpleSearchInner` (11187, 11319, and the deterministic precompute at 13717), plus `english-fallback` at 14722 and `recoverUnmatchedQuery` at 14384. Each re-translates.
- **Vector search** happens in three places: the emergency semantic expansion at 13810, the zero-text-match fallback at 14438, and Phase 1 at 15358.
- **The filter path fights itself.** Inside the perfect-match branch, nine post-processing steps run in sequence (11564–11771). Step B2 narrows the set to exact soft-category matches; step B3 immediately re-adds the whole aisle from Mongo; step B4 adds more by name; step B6 narrows again. A colour constraint applied at B8 (added today) is the only thing that survives all of it.

### The consequences we hit today

Both bugs fixed this morning were symptoms of this structure, not isolated defects:

- `strong` returned one nail drill and 24 gel polishes, because a description hit ranked equal to a name hit and returned as a "perfect match" that skipped validation.
- `לק סגול` returned a purple bed sheet, because a two-letter Hebrew noun was dropped by a length filter, the query never reached the filter tier, and colour was a ranking boost rather than a constraint.

---

## 2. Target architecture

A single orchestrator, with the tiers as named functions that share one prepared query object.

```
searchProducts(query, store)
  │
  ├── prepare: normalise, tokenise, detect language, load store filters
  │
  ├── TIER 1  literalMatch()          → answer or fall through
  ├── TIER 2  filterMatch()           → answer or fall through
  ├── TIER 3  translatedTextMatch()   → answer or fall through
  └── TIER 4  semanticMatch()         → always answers
```

The query is prepared **once**. Translation, embedding, and filter extraction each happen at most once per request and are shared down the chain rather than recomputed per branch.

### Tier 1 — literal match

Answers when the shopper named one thing. Three cases:

- SKU / barcode / model identifier.
- Product name equal to the query.
- **Full brand name** — the query is a brand that appears in product names. This is the `strong` case: 5 products carry it in the name, 664 carry it as an adjective in `description1`. A brand only counts when it matches `name` or `author`; description text never qualifies at this tier.

Everything else falls through. A query like `יין אדום` is not a literal match even though both words appear in product names — it describes an aisle, so tier 2 owns it.

### Tier 2 — filter match

Answers when every meaningful word in the query resolves to a known filter: hard category, soft category, colour, or price. This is `detectPerfectFilterMatch` plus a **single** filtered query. Colours, categories and price are all constraints. No step may re-add products that a constraint excluded.

### Tier 3 — translation and close textual match

Answers when the words are right but the catalog spells them differently: Hebrew query against a Latin-script catalog, English query against a Hebrew catalog, inflections, partial names, head-plus-collocation names. One translation, then one close-match query against name and description.

### Tier 4 — semantic

Vector search over embeddings, plus an AI pass that sees the store context and the candidate set. This tier is the only one allowed to return "nothing relevant", and it owns the never-empty behaviour.

---

## 3. Branch-by-branch mapping

Every existing branch, and where it goes.

### Tier 1 — literal

| Current | Lines | Action |
|---|---|---|
| SKU lookup (`resolveSkuQueryProducts`) | 13616–13637 | **Keep**, move into tier 1 |
| `findDirectExactNameMatches` (A1) | 11134–11145 | **Keep** as the exact-name case |
| `findDirectCatalogFieldMatches`, name/author stage | 632–680 | **Keep** as the brand case (name/author only; the two-stage split landed today) |
| `findDirectNumericModelMatches` (A10) | 11361–11376 | **Merge** into the SKU/identifier case |
| `findDirectAuthorMatches` (A2) | 11147–11158 | **Keep**, gated on `store.searchAuthor`; an author is a literal name |

### Tier 2 — filters

| Current | Lines | Action |
|---|---|---|
| `detectPerfectFilterMatch` | 12933–13330 | **Keep**, including today's head-word mapping |
| Atlas perfect-match pipeline | 11433–11516 | **Keep** as the single filtered query |
| Direct Mongo fallback | 11523–11560 | **Keep** — needed when the Atlas index is unavailable |
| B2 soft-category JS filter | 11567–11586 | **Merge** into the query itself |
| B3 direct soft-category supplement | 11588–11623 | **Delete** — re-adds what B2 just removed |
| B4 direct-name supplement | 11625–11644 | **Delete** — name matching belongs to tiers 1 and 3 |
| B5 specific soft-category preference | 11646–11677 | **Merge** into ranking |
| B6 soft intent gate | 11681–11693 | **Delete** — compensates for B3/B4 |
| B7 hard category safety net | 11699–11717 | **Merge** into the query |
| B8 colour filter | 11726–11744 | **Keep** — added today; becomes one constraint among equals |
| B9 name-relevance re-ranking | 11750–11771 | **Keep** as the single ranking step |
| `extractFiltersBrief` → `findPreciseFilterCatalogMatches` (A11) | 11382–11418 | **Merge** — LLM filter extraction becomes tier 2's fallback when literal filter matching fails |

Nine post-processing steps collapse to: one query, one ranking.

### Tier 3 — translation and close textual

| Current | Lines | Action |
|---|---|---|
| `findBroadSingleTokenNameMatches` (A6) | 11250–11264 | **Keep** |
| `findDirectTranslatedNameMatches` (A7b) | 11290–11297 | **Keep** — stops reporting itself as an exact match |
| `findHeadCollocationNameMatches` (A8) | 11302–11311 | **Keep** |
| `findDirectCatalogFieldMatches`, description stage (A4) | 11173–11183 | **Keep**, as a description-level close match only |
| Hebrew-translate group (A5a–A5d) | 11187–11243 | **Merge** into the single translation step |
| Translation group (A9a, A9b) | 11319–11357 | **Merge** into the single translation step |
| `english-fallback` | 14722–14776 | **Merge** — same idea, later in the pipeline |
| `recoverUnmatchedQuery` | 14384–14407 | **Merge** |
| `findFuzzyAuthorMatches` (A3, A7a) | 11159–11170, 11277–11288 | **Keep**, gated on `store.searchAuthor` |
| Atlas autocomplete/fuzzy path (C) | 11774–11900 | **Keep** as tier 3's last attempt |

Five translation sites become one.

### Tier 4 — semantic

| Current | Lines | Action |
|---|---|---|
| Phase 1 full pipeline | 14799–17274 | **Keep**, becomes tier 4's body |
| Emergency semantic expansion | 13810–13894 | **Delete** — tier 4 already does this |
| Zero-text-match vector fallback | 14438–14605 | **Merge** into tier 4 |
| `unifiedSearchDecision` | 6806–6975 | **Reduce** to relevance validation; tier routing is structural now |
| LLM rerank (`reorderResultsWithGPT`) | 16178–16297 | **Keep** |
| `findAiRecommendations` | 11913 | **Keep** |
| `attachNeverEmptySearchResults` | 4765–4797 | **Keep**, as tier 4's floor |

---

## 4. Cross-cutting concerns

These sit outside the tiers and must survive untouched. Each is a live behaviour some store depends on:

- Pinned / promoted products (13604–13610) — prepend to whatever tier answers.
- Permanent merchandising rules and A/B experiments (13586–13599) — patch store config before any tier runs.
- Stock filtering, out-of-stock fallbacks, `showOutOfStock` (14126–14226).
- Hidden-product exclusion (`HIDDEN_MONGO_FILTER`, `HIDDEN_SEARCH_FILTER`).
- Atlas-index-unavailable degradation (14674–14697, 17292–17317).
- Session personalisation and profile boosting (16649–16736).
- Pagination and load-more tokens.
- Query logging — this is also the eval corpus, so it must keep working.
- Author search, gated per store.
- Concierge gating, which changes empty-result behaviour.
- Accessory-versus-device demotion (`filterAccessoriesForDeviceQuery`).
- Redis caching of translations, embeddings and store config.

---

## 5. Response surface

Roughly thirty `searchMode` values collapse to four, plus a diagnostic field naming the branch within the tier:

```json
{ "tier": "literal" | "filter" | "translated" | "semantic",
  "matchedBy": "exact-name" | "brand" | "sku" | "soft-category+colour" | ... }
```

`searchMode` should be kept as an alias for one release so the dashboard and any client code do not break.

---

## 6. Risk and validation

**There is no test suite.** The repo has a handful of ad-hoc shell scripts and no golden set. A 4,500-line rewrite of the core retrieval path, serving 60+ live stores, cannot be validated by spot checks — today already showed queries that flip between runs because an LLM translates `רצועות לשעון` as either "watch straps" or "watch bands".

**There is an excellent corpus.** Every store logs real traffic to its `queries` collection:

| Store | Logged queries |
|---|---|
| steimatzky | 422,571 |
| garmin | 24,287 |
| beautics | 20,725 |
| mendelson | 14,175 |
| carmella | 805 |

Proposed harness, to exist before any tier is moved:

1. Pull the top N real queries per store from `queries`.
2. Snapshot each against the current build: tier, count, top 10 product ids.
3. Re-run against the rewritten build and diff.
4. Repeat each diverging query three times per build to separate LLM noise from real change — the method used to clear today's four false regressions.
5. Review remaining diffs by hand and classify: fix, regression, or noise.

Without step 4 the noise floor swallows the signal.

---

## 7. Staging

1. **Harness** — build and snapshot the current behaviour. Nothing changes in production.
2. **Skeleton** — introduce `searchProducts` with the four tiers, implemented by calling the existing helpers in the new order. Behind a per-store flag, off everywhere.
3. **Beautics first** — enable the flag for one store, compare against its 20k logged queries, iterate.
4. **Widen** — one vertical at a time: alcohol, books, jewellery, Garmin. Each has different tier pressure; the bookstore leans on author search, Garmin on model numbers.
5. **Delete** — remove the branches marked Delete above, and drop the `searchMode` alias.

Steps 1–2 are safe and reversible. Step 3 is the first behaviour change any shopper sees.

---

## 8. Open questions

- **Tier 1 brand detection.** Is a brand list maintained per store, or inferred from names that repeat across many products? Inference is cheaper to launch and wrong more often.
- **Tier 2 with partial filter coverage.** `לק סגול` works because both words resolve. What should `לק סגול מנצנץ` do when only two of three resolve — answer from tier 2 on the two, or fall to tier 3?
- **Tier boundaries when a tier answers badly.** If tier 2 returns three products for an aisle that should have fifty, does it still own the query, or does a minimum-result threshold hand it down?
- **Colour tagging coverage.** Only 1,043 of 3,403 Beautics products carry colour tags. A colour constraint can only ever return tagged products; improving coverage is a data problem that limits what tier 2 can do.
