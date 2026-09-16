# Garmin module

`processor.mjs` exports `processGarmin(raw)` and `garminProfile(previous, products)`. `profile.json` contains the current generated tenant policy. The module derives internal search attributes for series, display, solar charging, music storage, materials and size while preserving source badges. Attributes are not display badges.

Music storage is established by an explicit Music model name or affirmative product specification. Square-screen recognition is restricted to Venu Sq. Accessories and treatment plans do not receive watch-family attributes.

The `/search` route dispatches authenticated stores with `dbName === 'garmin'` when `GARMIN_SEARCH_V2=true`. Products are read from the store's configured collection (default `products`) in that database. Published, visible, in-stock products are adapted from the Woo sync format; embeddings are excluded. Catalog cache is bounded to 10,000 products and refreshed after 60 seconds. Catalog schema adaptation, attribute processing and search run in this tenant adapter using `search-runtime/`.

Set `GARMIN_SEARCH_V2=true` and `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in Render and deploy this commit. Optional model overrides are `GARMIN_ROUTER_MODEL` and `GARMIN_SEARCH_MODEL`. Disabling the flag routes new searches back to the existing pipeline. Existing Garmin snapshot pages can still be read until expiry.

POST `/search` accepts `{query, modern:true, limit:12}` or `{cursor, modern:true, limit:12}` with the existing storefront API key. Modern responses include `products`, `badges`, metadata `searchEngine: garmin-v2`, and `pagination.nextToken`. Legacy requests retain the product-array contract; continuation is also returned in `X-Next-Token`. GET `/search/load-more?token=garmin-v2:<cursor>&limit=20` continues the same ranked snapshot. Snapshots persist in `garmin_search_sessions` with a 30-minute TTL, surviving worker changes without rerunning LLM or reordering results. Wrong-tenant tokens are rejected; expired snapshots return HTTP 410.

No Studio credentials or catalog data are included. This pipeline uses the connected Mongo catalog rather than the public Studio sample. Missing descriptions or merchant badges in Mongo remain missing; the route does not scrape or overwrite inventory. Attribute tags are derived at catalog load time. LLM retrieval is bounded and unsupported requests may return explicitly marked alternatives.
