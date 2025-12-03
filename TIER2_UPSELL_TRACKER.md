# Tier 2 Upsell Tracker

## Overview

The Tier 2 Upsell Tracker is a mechanism that identifies and tracks when products from **tier 2 (embedding-based similarity search)** are added to the cart. This provides valuable insights into the effectiveness of the semantic product recommendation system.

## What is a Tier 2 Upsell?

A **tier 2 upsell** occurs when:
1. A product is found through **embedding similarity** (tier 2) rather than text-based search (tier 1)
2. The user adds this product to their cart
3. The product was NOT in the original search results (tier 1), making it a true "upsell" discovery

## How It Works

### System Flow

```
User searches "יין אדום יבש"
    ↓
TIER 1: Text search finds exact matches
    ↓
User scrolls/loads more results
    ↓
TIER 2: Embedding similarity finds related products
    ↓
User adds a tier 2 product to cart
    ↓
System marks it as tier2Upsell = true
    ↓
Analytics track tier 2 conversion effectiveness
```

### Implementation Details

The tracker is implemented in the `/search-to-cart` endpoint (lines 6359-6383 in `server.js`).

#### New Fields in Cart Collection

When a product is added to cart, the following new fields are tracked:

| Field | Type | Description |
|-------|------|-------------|
| `tier2Product` | Boolean/null | Whether the product was in tier 2 results |
| `tier2Upsell` | Boolean/null | Whether this is a true tier 2 upsell (in tier 2 but NOT in tier 1) |

#### Values Explanation

- `tier2Product = true`: Product was found via embedding similarity
- `tier2Product = false`: Product was NOT in tier 2 results
- `tier2Product = null`: No tier 2 data provided (unknown)

- `tier2Upsell = true`: Product is from tier 2 AND not from tier 1 (true upsell!)
- `tier2Upsell = false`: Product is in tier 2 but was also in tier 1 (overlap)
- `tier2Upsell = null`: No tier 2 data provided (unknown)

## Client-Side Integration

### Request Format

When calling `POST /search-to-cart`, include the `tier2_results` field:

```javascript
{
  "x-api-key": "your_api_key",  // Header
  "document": {
    "search_query": "יין אדום יבש",
    "product_id": "12345",
    "event_type": "add_to_cart",
    "session_id": "session-xyz",
    "timestamp": "2025-12-03T12:00:00Z",

    // Tier 1 results (original search results)
    "search_results": ["Product A", "Product B", "Product C"],

    // 🧬 NEW: Tier 2 results (embedding similarity results)
    "tier2_results": ["Product D", "Product E", "Product F"],

    "searchMetadata": {
      "query": "יין אדום יבש",
      "classification": "complex",
      "llmReorderingUsed": true,
      // ... other metadata
    }
  }
}
```

### How to Populate `tier2_results`

The client should track which products were shown from tier 2:

```javascript
// Example client-side tracking
let tier1Products = [];  // From initial /search call
let tier2Products = [];  // From /search/load-more call

// When initial search completes
searchAPI.search(query).then(response => {
  tier1Products = response.results.map(p => p.name);
  displayProducts(response.results);
});

// When user scrolls and loads more (tier 2 activated)
searchAPI.loadMore(nextToken).then(response => {
  // These are tier 2 products (from embedding similarity)
  tier2Products = response.results.map(p => p.name);
  displayProducts(response.results);
});

// When user adds product to cart
function addToCart(product) {
  trackingAPI.addToCart({
    search_query: currentQuery,
    product_id: product.id,
    event_type: "add_to_cart",
    search_results: tier1Products,      // Tier 1 products
    tier2_results: tier2Products,        // 🧬 Tier 2 products
    // ... other fields
  });
}
```

## Example Scenarios

### Scenario 1: True Tier 2 Upsell ✅

```javascript
// Request
{
  "search_query": "יין אדום",
  "product_id": "12345",
  "search_results": ["Barkan Merlot", "Carmel Cabernet", "Golan Heights Syrah"],
  "tier2_results": ["Dalton Petit Verdot", "Recanati Shiraz", "Tabor Malbec"]
}

// If user adds "Dalton Petit Verdot" (product_id: 12345):
// Result in cart collection:
{
  "product_id": "12345",
  "upsale": false,           // Not in original search_results
  "tier2Product": true,      // Was in tier2_results
  "tier2Upsell": true        // ✅ TRUE TIER 2 UPSELL!
}
```

**Analysis**: This product was discovered ONLY through embedding similarity, not text search. This is the value of tier 2!

---

### Scenario 2: Tier 1 Product (No Tier 2 Involvement)

```javascript
// Request
{
  "search_query": "יין אדום",
  "product_id": "67890",
  "search_results": ["Barkan Merlot", "Carmel Cabernet", "Golan Heights Syrah"],
  "tier2_results": ["Dalton Petit Verdot", "Recanati Shiraz", "Tabor Malbec"]
}

// If user adds "Barkan Merlot" (product_id: 67890):
// Result in cart collection:
{
  "product_id": "67890",
  "upsale": true,            // Was in original search_results
  "tier2Product": false,     // Not in tier2_results
  "tier2Upsell": false       // Not a tier 2 upsell
}
```

**Analysis**: User added a tier 1 product. Tier 2 didn't influence this decision.

---

### Scenario 3: Product in Both Tier 1 AND Tier 2 (Overlap)

```javascript
// Request
{
  "search_query": "יין אדום",
  "product_id": "11111",
  "search_results": ["Barkan Merlot", "Carmel Cabernet", "Golan Heights Syrah"],
  "tier2_results": ["Golan Heights Syrah", "Dalton Petit Verdot", "Recanati Shiraz"]
}

// If user adds "Golan Heights Syrah" (product_id: 11111):
// Result in cart collection:
{
  "product_id": "11111",
  "upsale": true,            // Was in original search_results
  "tier2Product": true,      // Also in tier2_results
  "tier2Upsell": false       // Not counted as tier 2 upsell (was already in tier 1)
}
```

**Analysis**: Product appeared in both tiers. We don't count this as a tier 2 upsell since the user saw it in tier 1 first.

---

### Scenario 4: No Tier 2 Data Provided

```javascript
// Request (legacy format without tier2_results)
{
  "search_query": "יין אדום",
  "product_id": "12345",
  "search_results": ["Barkan Merlot", "Carmel Cabernet"]
  // No tier2_results provided
}

// Result in cart collection:
{
  "product_id": "12345",
  "upsale": false,           // Not in search_results
  "tier2Product": null,      // Unknown (no tier 2 data)
  "tier2Upsell": null        // Unknown (no tier 2 data)
}
```

**Analysis**: Legacy request format. No tier 2 tracking available.

## Analytics & Monitoring

### Key Metrics to Track

1. **Tier 2 Conversion Rate**
   ```javascript
   // Query: Products added from tier 2
   db.cart.countDocuments({ tier2Upsell: true })
   ```

2. **Tier 2 vs Tier 1 Performance**
   ```javascript
   // Tier 1 conversions
   db.cart.countDocuments({ upsale: true, tier2Upsell: { $ne: true } })

   // Tier 2 conversions
   db.cart.countDocuments({ tier2Upsell: true })
   ```

3. **Embedding Similarity Effectiveness**
   ```javascript
   // Total products shown from tier 2 (need to track separately)
   // vs products added from tier 2
   db.cart.countDocuments({ tier2Upsell: true })
   ```

### Log Messages

When a tier 2 upsell is detected, you'll see:

```
[SEARCH-TO-CART] 🧬 Tier 2 tracking: product_name="Dalton Petit Verdot", in_tier2_results=true, tier2_upsell=true, tier2_results_count=15
[SEARCH-TO-CART] ✅ TIER 2 UPSELL DETECTED: Product "Dalton Petit Verdot" added to cart from embedding similarity results
```

## Query Examples

### Find All Tier 2 Upsells

```javascript
db.cart.find({
  tier2Upsell: true
}).sort({ created_at: -1 })
```

### Tier 2 Upsell Rate by Query

```javascript
db.cart.aggregate([
  { $match: { tier2Product: { $ne: null } } },
  { $group: {
    _id: "$search_query",
    total_adds: { $sum: 1 },
    tier2_upsells: {
      $sum: { $cond: ["$tier2Upsell", 1, 0] }
    }
  }},
  { $project: {
    query: "$_id",
    total_adds: 1,
    tier2_upsells: 1,
    tier2_upsell_rate: {
      $multiply: [
        { $divide: ["$tier2_upsells", "$total_adds"] },
        100
      ]
    }
  }},
  { $sort: { tier2_upsells: -1 } }
])
```

### Revenue from Tier 2 Upsells

```javascript
db.cart.aggregate([
  { $match: { tier2Upsell: true } },
  { $group: {
    _id: null,
    total_cart_value: { $sum: "$cart_total" },
    count: { $sum: 1 }
  }}
])
```

## Benefits

1. **Measure Embedding ROI**: Track how many conversions come from semantic similarity vs text search
2. **Optimize Tier 2 Strategy**: Identify which queries benefit most from tier 2
3. **Product Discovery Insights**: Understand which product relationships drive purchases
4. **A/B Testing**: Compare conversion rates with/without tier 2 enabled
5. **Revenue Attribution**: Calculate revenue directly attributable to embedding recommendations

## Technical Notes

- **Backward Compatible**: If `tier2_results` is not provided, tracking gracefully degrades (sets to null)
- **No Breaking Changes**: Existing clients continue to work without modifications
- **Efficient**: Uses existing product lookup logic, no additional database queries
- **Scalable**: Fields are indexed for fast querying and analytics

## Related Documentation

- [TIER2_EMBEDDING_SUMMARY.md](./TIER2_EMBEDDING_SUMMARY.md) - Complete tier 2 system documentation
- [TIER2_EMBEDDING_ENHANCEMENT.md](./TIER2_EMBEDDING_ENHANCEMENT.md) - Implementation details
- [TIER2_FLOW_DIAGRAM.md](./TIER2_FLOW_DIAGRAM.md) - Visual flow diagrams

## Implementation Checklist

- [x] Add tier 2 tracking fields to cart collection
- [x] Implement detection logic in /search-to-cart endpoint
- [x] Add logging for tier 2 upsells
- [ ] Update client to send tier2_results
- [ ] Create analytics dashboard for tier 2 metrics
- [ ] Set up monitoring alerts for tier 2 conversion rates
- [ ] A/B test tier 2 effectiveness across different query types
