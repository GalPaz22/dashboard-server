# Beautics pilot — local search and product-card review

This is an isolated, read-only catalog pilot, not the production replacement.
It uses the existing WooCommerce sync output from `woo-beautics-shop-co-il.products`.
No production route, document, Atlas index or synchronization job is changed.

## Run

From the repository root:

```sh
node pilot/beautics/capture.mjs
curl --max-time 25 -sSL https://www.beautics-shop.co.il/ -o outputs/beautics-pilot/source-home.html
python3 pilot/beautics/extract-source.py outputs/beautics-pilot/source-home.html > outputs/beautics-pilot/source-badges.json
node pilot/beautics/build.mjs
node --test pilot/beautics/core.test.mjs
node pilot/beautics/serve.mjs
```

Open `http://127.0.0.1:4318/` for the RTL card preview: search, autocomplete,
load more and source-badge review. Card details distinguish observations from
unverified labels. This is an inspection interface, not the installed store widget.

Optional second evidence page (one request, no product crawl):

```sh
curl --max-time 25 -sSL 'https://www.beautics-shop.co.il/product-category/%d7%a1%d7%92%d7%95%d7%9c%d7%99%d7%9d' -o outputs/beautics-pilot/source-purple.html
python3 pilot/beautics/extract-source.py outputs/beautics-pilot/source-purple.html > outputs/beautics-pilot/source-purple-badges.json
node pilot/beautics/build.mjs
python3 -m unittest discover -s pilot/beautics -p 'test_*.py'
```

Restart the local server and reload after changing data or assets; both are loaded
once at startup. Only capture reads Mongo, using the existing local environment. Subsequent build,
build and unit tests run offline. The preview server now uses Gemini only when
text retrieval finds zero matches. Outputs are gitignored. Reuse
the captured files for iteration rather than repeating live reads.

API binds exclusively to `127.0.0.1:4318`:

```sh
curl -s http://127.0.0.1:4318/search -H 'Content-Type: application/json' -d '{"query":"לק סגול","limit":5}'
curl -s 'http://127.0.0.1:4318/autocomplete?query=strong'
```

Pass `{"cursor":"<nextCursor>","limit":5}` to the same search route to load more.
The preview uses opaque random cursors bound to an in-memory result session, with
a ten-minute TTL. Load more never invokes the LLM. Restarting the server expires
all cursors. The lower-level offline `core.mjs` cursor is not used by HTTP anymore.
The server binds to loopback and checks Host, Origin and JSON content type. It
must not be exposed publicly; deployed use still requires proper authentication.

## LLM fallback

`semantic.mjs` wraps the lexical engine. Nonempty text matches return immediately,
without a model call; autocomplete never invokes a model. Before the LLM, a
conservative spelling resolver compares short residual queries with title phrases
from this tenant's visible, in-stock catalog. It joins/splits words and permits
one edit (two for strings of at least ten characters), while retaining hard filters.
Numeric identifiers, short words, long sentences and ambiguous equal-distance
interpretations are not automatically repaired. The preview reports the correction.
For example, `אולטרה סוני` matches both `אולטרה סוניק` and `אולטראסוניק`, returning
three in-stock products without LLM calls. Autocomplete remains prefix-based for now.
A query still returning zero results first goes through `router.mjs`: one small
Flash-Lite call classifies lexical normalization, semantic need, consultation or
clarification. Lexical normalization returns up to three equivalent queries;
these run through text retrieval while keeping detected constraints and numbers.
Examples verified live: `סטרונג` → `strong` (3 products), `פרנצ׳` → `פרנץ׳`
(18 products). The router receives at most 250 frequent/distinct catalog words,
including a dedicated Latin-script vocabulary sample; it never sees product records.

Semantic/consultative requests, unavailable routing, or unsuccessful rewrites
continue using the ORIGINAL query through at most two deeper Gemini calls:

1. Interpret the original request using the catalog's category vocabulary,
   preserving detected constraints and extracting further requirements.
2. Select/rank from at most 100 eligible catalog candidates. Every selected ID
   must exist in the eligible set, and every interpreted requirement must have
   a quoted field reference that exists in that product record.

Type, known colors, finish, stock, visibility and detected price limits are checked
in code before candidate selection. The LLM cannot rewrite price, image or badges.
Unsupported suitability should return empty or clarify. Exact quote validation
proves the quote exists, not that the model's semantic interpretation is always
correct. Labeled relevance evaluation is still required, particularly for complex
attributes and ambiguous needs. Candidates are bounded and recall is not exhaustive.

The pilot is explicitly `neverEmpty`: when the model cannot verify a full match,
the server returns up to 12 visible, in-stock catalog alternatives with
`matchQuality: "alternative"`, `exactMatch: false` and a Hebrew explanation.
These are catalog products, never invented products. The only true zero-result
case is an empty/invalid catalog; an empty query still makes no search request.
This prevents an empty grid while keeping alternatives visibly distinct from
products that satisfy every requirement.

Every response carries a phase: `lexical` for a full text match, `spelling` for
catalog-based repair, `router-lexical` for the lightweight LLM rewrite, `deep-llm`
for contextual semantic/consultative retrieval, and `fallback` for catalog
alternatives. The deep phase receives the Beautics tenant, WooCommerce platform,
beauty/nail-supply domain, schema version, product-type vocabulary, colors,
finishes and index intent. A deep result is therefore grounded in this store's
catalog contract rather than a generic shopping prompt.
This is LLM-guided catalog retrieval/ranking, not embedding/vector search.

The router deadline is 10 seconds and the deeper search deadline is 30 seconds
(at most three model calls and 40 seconds total). There are at most two concurrent
LLM search requests. Normalized lexical matches use one model call; local spelling
and exact text use none. There are
no provider retries, coalescing of identical requests and a bounded
ten-minute result cache. Provider/validation failure returns `degraded`, never a
successful empty result; failures are not cached as answers. Metadata distinguishes
text/LLM/cached results and reports model usage and candidate truncation.

Uses the existing `GEMINI_API_KEY` or `GOOGLE_API_KEY` from the server environment.
`BEAUTICS_PILOT_MODEL` optionally overrides the deeper `gemini-2.5-flash` model;
`BEAUTICS_ROUTER_MODEL` overrides the lighter `gemini-2.5-flash-lite`. No keys are sent to
the browser. Only category vocabulary and selected public product fields are sent
to Gemini, not database credentials, shopper profiles or the entire catalog.

```sh
node --test pilot/beautics/*.test.mjs
```

Live checks were limited to two distinct natural-language requests about collecting
nail-filing dust (with/without a 500 ILS ceiling), plus repair of a provider schema
limit. A stored interpretation was reused for that repair. Live outputs are saved
locally under `outputs/beautics-pilot/llm-*.json`; do not replay a live corpus.

## Findings from 2026-09-11

- 3,404 products captured with an allowlist of product-only fields.
- 173 products have `tags`; most tags are descriptive terms.
- 1,394 products have candidate labels under selected categories/tags. This is a
  review queue, not a count of verified or active promotions.
- Observed 35 cards across the homepage and first purple-category page, attaching
  DOM badges to 32 matching catalog records. `.custom-label`,
  `.matat_sale_badge` and `.sold-out-label` are the observed source selectors.
- Nine products have `specialLabel: true` without a semantic label. No text is
  invented for these records.
- The synced status vocabulary is `ACTIVE`, `PRIVATE`, `DRAFT`; `active` matches
  stock availability in this snapshot and must not be treated as publication.
- Two product types, three colors and glitter finish are mapped in this slice.
  These are conservative client rules, not a complete Beautics schema.

The prototype returns 3 name-matching in-stock products for `strong`, 30 products
with mapped nail-polish type and purple evidence for `לק סגול`, and 28 when a
maximum price of 50 is added. These counts are snapshot observations, not a
human relevance score or proof of recall. `לק סגול מנצנץ` returns four products
based on explicit `מנצנצים` category evidence, including a product whose title
does not mention glitter. Additional unknown terms remain text requirements.

## What the badge rules guarantee

Category membership alone never becomes a displayed badge. `חדש באתר` and
commercial labels such as `10 ב399 ש״ח` remain candidates until product-level
evidence or a verified merchant rule supports them. Homepage/category DOM observations
are scoped to product URL, deduplicated, timestamped and cross-checked for sale
and stock contradictions. A homepage sample does not prove rules for the rest
of the catalog. The generic `specialLabel` boolean remains unresolved. The purple
category page confirms `10 ב399 ש״ח` as a `.custom-label` on specific products;
that CSS class does not always mean "new". Matching candidates are marked
`observed-on-product` rather than shown a second time as pending.

The local build is a complete derived snapshot: it does not mutate source tags.
Rebuilding without an observation removes that preview badge. Production partial
sync must implement source ownership, successful-full-snapshot semantics and
expiry before these observations can be used as ongoing promotion claims.

## Artifacts

- `outputs/beautics-pilot/report.json`: coverage, source times and data issues.
- `outputs/beautics-pilot/products.json`: normalized products and card data,
  including badge evidence and a separate candidate review queue.
- `outputs/beautics-pilot/query-results.json`: twelve offline query examples.
- `client.json`: initial field semantics, badge candidates and index intent.

## Remaining before live pilot

1. Locate the existing sync producer/plugin and verify update/delete semantics;
   the inspected repository search routes do not establish this behavior.
2. Verify merchant-wide badge rules on category/product pages and identify any
   coupon, date or eligibility dependencies. Extend the data model to variants.
3. Extend the local card renderer into the store widget and build URL/platform onboarding.
4. Label 10–15 real queries with accepted/rejected IDs, extend field mappings
   beyond the currently mapped type/color/finish, then compare retrieval strategies.
5. Compile and validate a separate Atlas index; evaluate the LLM fallback against
   labeled cases, then add vector retrieval/assistant tools where justified.
6. Add production-compatible authentication, pagination and frontend integration;
   validate release/rollback and incremental sync before routing live traffic.

The current text scan is a runnable reference for constraint preservation, not
the final index implementation. The index plan is declarative intent only.

## Validation of the second slice

Ten Node tests and two Python extraction tests pass. Browser verification checked
12→24 products through load more, four glitter results, displayed images and
product-scoped badge/source details. The page's optional WebMCP search action was
called successfully and rejected an empty query. No semantic search calls,
production writes or Atlas changes were made in that slice. Full autocomplete keyboard and
multi-device interaction testing remains before storefront delivery.
