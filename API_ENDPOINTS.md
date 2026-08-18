# API Endpoints Summary

## 🔍 **Main Search Endpoint**

### `POST /search`
Main search endpoint with auto-load-more functionality.

**Headers:**
- `Content-Type: application/json`
- `X-API-Key: your-api-key`

**Request Body:**
```json
{
  "query": "gift",
  "context": "optional merchant-provided store context",
  "useImages": false,
  "example": "",
  "noWord": "",
  "noHebrewWord": ""
}
```

**Response:**
```json
{
  "products": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "id": "12345",
      "name": "Premium Red Wine",
      "description": "Full-bodied red wine with notes of cherry and oak",
      "price": 89.90,
      "image": "https://example.com/images/wine1.jpg",
      "url": "https://example.com/products/wine1",
      "ItemID": "WINE001"
    },
    {
      "_id": "507f1f77bcf86cd799439012",
      "id": "12346",
      "name": "White Wine Selection",
      "description": "Crisp white wine with citrus notes",
      "price": 65.00,
      "image": "https://example.com/images/wine2.jpg",
      "url": "https://example.com/products/wine2",
      "ItemID": "WINE002"
    }
    // ... more products (20 total)
  ],
  "pagination": {
    "hasMore": true,
    "hasSecondBatch": true,
    "totalAvailable": 45,
    "returned": 20,
    "autoLoadMore": true,
    "secondBatchToken": "eyJxdWVyeSI6IndpbmUiLCJ..."
  },
  "metadata": {
    "query": "wine",
    "requestId": "abc123",
    "batchNumber": 1,
    "executionTime": 234
  }
}
```

---

## 🔄 **Auto-Load-More Endpoints**

### `GET /search/auto-load-more?token=<secondBatchToken>`
Automatically loads the second batch of 20 products.

**Response:**
```json
{
  "products": [
    {
      "_id": "507f1f77bcf86cd799439021",
      "id": "12355",
      "name": "Sparkling Wine",
      "description": "Elegant sparkling wine perfect for celebrations",
      "price": 120.00,
      "image": "https://example.com/images/wine21.jpg",
      "url": "https://example.com/products/wine21",
      "ItemID": "WINE021"
    }
    // ... more products (20 total)
  ],
  "pagination": {
    "hasMore": false,
    "returned": 20,
    "batchNumber": 2
  },
  "metadata": {
    "query": "wine",
    "requestId": "def456",
    "cached": true,
    "autoLoaded": true
  }
}
```

### `GET /search/load-more?token=<nextToken>&limit=20`
Manual pagination for products beyond the first 40.

---

## 💊 **Health & Monitoring**

### `GET /health`
Check server health (no authentication required).

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-20T13:41:04.709Z",
  "uptime": 123.45,
  "services": {
    "redis": {
      "connected": true,
      "status": "healthy",
      "ping": true
    },
    "mongodb": {
      "connected": true,
      "status": "healthy"
    }
  }
}
```

### `GET /cache/stats`
Get Redis cache statistics (no authentication required).

**Response:**
```json
{
  "redis": {
    "connected": true,
    "ready": true,
    "dbSize": 8388,
    "version": "7.4.3",
    "hitRate": "60.98%",
    "usedMemory": "325.68M",
    "uptime": "143h 54m"
  }
}
```

---

## 🗑️ **Cache Management**

### `POST /cache/clear`
Clear cache by pattern or all (no authentication required).

**Request Body:**
```json
{
  "pattern": "translate"  // Optional
}
```

### `DELETE /cache/key/:key`
Delete specific cache key (no authentication required).

### `POST /cache/warm`
Warm cache with common queries (no authentication required).

---

## 📋 **Flow Example**

```javascript
// 1. Initial search
const response1 = await fetch('http://localhost:8000/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'semantix_688736e523c0352ad78525fe_1753691812345'
  },
  body: JSON.stringify({
    query: 'gift',
    context: 'optional merchant-provided store context'
  })
});

const data1 = await response1.json();
// Shows first 20 products
displayProducts(data1.products);

// 2. Auto-load second batch if available
if (data1.pagination.hasSecondBatch) {
  const response2 = await fetch(
    `http://localhost:8000/search/auto-load-more?token=${data1.pagination.secondBatchToken}`
  );
  
  const data2 = await response2.json();
  // Shows next 20 products
  appendProducts(data2.products);
}

// Total: 40 products loaded automatically
```

---

## 🔑 **Authentication**

Most endpoints require the `X-API-Key` header:
```
X-API-Key: semantix_688736e523c0352ad78525fe_1753691812345
```

**Endpoints that DON'T require authentication:**
- `/health`
- `/cache/stats`
- `/cache/clear`
- `/cache/warm`
- `/cache/key/:key`

---

## 📊 **Pagination Details**

- **First batch**: 20 products (immediate)
- **Second batch**: 20 products (auto-loaded, cached for 60s)
- **Manual pagination**: Products 41-65 (via `/search/load-more`)
- **Maximum per search**: 65 products total

---

**Server URL**: `http://localhost:8000`  
**API Key**: `semantix_688736e523c0352ad78525fe_1753691812345`


---

## 💬 **Concierge (shopper-facing chat, Hebrew)**

Opt-in per store via a top-level `concierge: true` on the user document:

```js
db.users.updateOne({ apiKey: "…" }, { $set: { concierge: true } })
```

Any other state — field missing, `false`, or set somewhere else — leaves the
store exactly as it was: search responses carry no trigger and every
`/concierge/*` route returns `403`. Store config is cached for 5 minutes, so a
change takes up to that long to take effect.

Optional settings (`conciergeAutoOpen`, `conciergeContext`,
`conciergeSystemPrompt`) are read from the top level first, then `credentials`.

### The trigger

`/search` and `/fast-search` responses gain a `metadata.concierge` block when
the query is one a product grid can't answer:

```json
{
  "metadata": {
    "concierge": {
      "enabled": true,
      "should_open": true,
      "display": "auto",
      "reason": "no_results",
      "query": "יין פורט בן 40 שנה",
      "conversation_id": "cnv_4f2c…",
      "opener": "לא מצאתי מוצר שתואם בדיוק…",
      "product_ids": ["123", "456"]
    }
  }
}
```

`reason` is one of `no_results`, `out_of_stock` (only visible on stores that
show out-of-stock products — elsewhere the stock gate turns it into
`no_results`, and the chat works out which it was), or `non_literal`.
`non_literal` is also emitted when the grid has products but none is a lexical
match; vector/category fallback products therefore do not suppress Concierge.
The model receives the store's top-level `user.context`, checks the requested
item including out-of-stock inventory, and can reason from its attributes to
find alternatives.
`display` is `auto` (fade the chat open) or `pill` (invite first), controlled by
`conciergeAutoOpen` (defaults to `auto`; set it to `false` for the pill).

Stores without Concierge still receive AI-ranked ordinary results for complex
or non-literal `/search` queries. That bounded reranking pass uses
`gemini-3.7-flash` by default (`COMPLEX_SEARCH_MODEL` can override it) and is
reported as `metadata.reasoningModel`; literal searches do not invoke it.

Legacy array responses have nowhere to put metadata, so the same signal ships as
headers: `X-Concierge-Trigger`, `X-Concierge-Conversation`, `X-Concierge-Display`.

### `POST /concierge/chat`

Streams SSE by default; pass `"stream": false` for one JSON reply.

```json
{
  "conversation_id": "cnv_4f2c…",
  "message": "מה מתאים לקינוח עד 150 שקל?",
  "trigger": { "reason": "no_results", "query": "יין פורט בן 40 שנה" },
  "session_id": "abc123"
}
```

Omit `message` on a new conversation to get the opening turn — the model looks
at the catalog first and opens with what it found.

The concierge uses `gemini-3.7-flash` by default (`CONCIERGE_MODEL` can override
it). Until Google publishes a dedicated 3.7 pricing row, estimates use the 3.6
Flash rates: $1.50/MTok uncached input and $7.50/MTok output. The
`CONCIERGE_*_USD_PER_MTOK` environment variables can override those rates.

SSE events: `meta` (conversation_id), `thinking`, `text` (streamed token),
`text_reset`, `tool_start`, `tool_end` (with `products` and a `layout` of
`recommendations` or `grid` for card rendering), `done` (usage), `error`. Comment frames
(`: keepalive`) keep proxies from dropping the connection during a tool round.

Limits: 1000 chars per message, 30 turns per conversation, 40 turns/hour per
shopper and 600 per 10 min per store (`429` with `retry_after_seconds`).

### `GET /concierge/conversation/:id`
Transcript of one conversation (3h TTL). Tool traffic stays internal.

### `POST /concierge/feedback`
`{ conversation_id, event, product_id? }` where event is one of `opened`,
`dismissed`, `closed`, `product_click`, `add_to_cart`, `helpful`, `not_helpful`.

### `GET /concierge/stats?days=30`
Conversations and turns by trigger reason, unique shoppers, product clicks,
cart adds, token totals and `estimated_cost_usd`. Every document in
`concierge_conversations` also stores cumulative `usage`, `cost_turns`,
`estimated_cost_usd` and the pricing rates used for the calculation.

### `GET /demo-concierge`

Live demo page (Hebrew, RTL). Runs a real search against the server, shows the
trigger decision it produced, and fades the chat open when the trigger says to —
so the conditional-render logic is visible rather than described. Set the server
URL and API key in the page header; both persist in `localStorage`.

It reads the trigger from `metadata.concierge` and falls back to the
`X-Concierge-*` headers when `modern` is unchecked, so it doubles as the
reference implementation for a storefront widget. It also has buttons that fire
prompt-injection and junk input at the chat to show the guards responding.

This route is exempt from API-key auth (it's HTML with no embedded credentials).
Note `/` and `/demo-enrichment` are still behind auth and return 401 in a
browser — unchanged from before.
