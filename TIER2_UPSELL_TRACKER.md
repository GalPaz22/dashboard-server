# Tier 2 Upsell Tracker

## Overview

The Tier 2 Upsell Tracker is a **fully automatic server-side mechanism** that identifies and tracks when products from **tier 2 (embedding-based similarity search)** are added to the cart. This provides valuable insights into the effectiveness of the semantic product recommendation system.

**Key Feature:** No client changes required! The system automatically:
1. Stores tier 2 products when they're returned from `/search/load-more`
2. Detects tier 2 upsells when products are added to cart
3. Tracks all tier 2 conversions in the cart collection

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
User scrolls/loads more results (/search/load-more)
    ↓
TIER 2: Embedding similarity finds related products
    ↓
🧬 SERVER AUTOMATICALLY STORES tier 2 products in tier2_tracking collection
    ↓
User adds a product to cart
    ↓
🧬 SERVER AUTOMATICALLY CHECKS if product was in tier 2 for this query
    ↓
System marks it as tier2Upsell = true if applicable
    ↓
Analytics track tier 2 conversion effectiveness
```

### Implementation Details

The tracker is implemented in two places:

1. **Storage** (`/search/load-more` endpoint, lines 4307-4352): Stores tier 2 products in `tier2_tracking` collection
2. **Detection** (`/search-to-cart` endpoint, lines 6406-6443): Automatically detects tier 2 upsells

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

## New Collections

### `tier2_tracking` Collection

Stores tier 2 products for automatic detection:

```javascript
{
  _id: ObjectId,
  query: "יין אדום יבש",                    // Search query
  tier2_products: ["Product D", "Product E", ...], // Array of tier 2 product names
  timestamp: ISODate("2025-12-03T12:00:00Z"),     // When tier 2 was returned
  expires_at: ISODate("2025-12-04T12:00:00Z"),    // TTL expiration (24 hours)
  request_type: "complex-tier2",                   // Type of tier 2 request
  product_count: 15                                // Number of tier 2 products
}
```

**Features:**
- Automatic TTL expiration (24 hours)
- Indexed by query for fast lookups
- Updated when new tier 2 products are returned for same query

## No Client Changes Required!

The system works **automatically** with your existing client code. The server handles all tier 2 tracking behind the scenes.

**Existing request format** (no changes needed):

```javascript
{
  "x-api-key": "your_api_key",  // Header
  "document": {
    "search_query": "יין אדום יבש",
    "product_id": "12345",
    "event_type": "add_to_cart",
    "session_id": "session-xyz",
    "timestamp": "2025-12-03T12:00:00Z",
    "search_results": ["Product A", "Product B", "Product C"], // Tier 1 only
    "searchMetadata": { ... }
  }
}
```

The server automatically:
1. Looks up if the product was in tier 2 for this query
2. Sets `tier2Product` and `tier2Upsell` fields
3. Logs tier 2 upsell detections

## Example Scenarios

### Scenario 1: True Tier 2 Upsell ✅

**User Journey:**
1. User searches "יין אדום"
2. Tier 1 returns: `["Barkan Merlot", "Carmel Cabernet", "Golan Heights Syrah"]`
3. User scrolls, loads more
4. Tier 2 (embedding similarity) returns: `["Dalton Petit Verdot", "Recanati Shiraz", "Tabor Malbec"]`
5. Server automatically stores tier 2 products in `tier2_tracking` collection
6. User adds "Dalton Petit Verdot" to cart

**Cart Request** (standard format, no tier 2 data needed):
```javascript
{
  "search_query": "יין אדום",
  "product_id": "12345",  // Dalton Petit Verdot
  "search_results": ["Barkan Merlot", "Carmel Cabernet", "Golan Heights Syrah"]
}
```

**Server automatically:**
1. Looks up tier2_tracking for query "יין אדום"
2. Finds "Dalton Petit Verdot" in tier 2 products
3. Checks it's NOT in tier 1 search_results

**Result in cart collection:**
```javascript
{
  "product_id": "12345",
  "upsale": false,           // Not in tier 1 search_results
  "tier2Product": true,      // ✅ Found in tier2_tracking
  "tier2Upsell": true        // ✅ TRUE TIER 2 UPSELL!
}
```

**Console logs:**
```
[SEARCH-TO-CART] 🧬 Tier 2 AUTO-DETECTION: product_name="Dalton Petit Verdot", in_tier2=true, tier2_upsell=true, tier2_count=15
[SEARCH-TO-CART] ✅ TIER 2 UPSELL DETECTED: Product "Dalton Petit Verdot" added to cart from embedding similarity results (query: "יין אדום")
```

**Analysis**: This product was discovered ONLY through embedding similarity, not text search. This is the value of tier 2!

---

### Scenario 2: Tier 1 Product (No Tier 2 Involvement)

**User Journey:**
1. User searches "יין אדום"
2. Tier 1 returns: `["Barkan Merlot", "Carmel Cabernet", "Golan Heights Syrah"]`
3. User immediately adds "Barkan Merlot" to cart (without scrolling/loading more)

**Result in cart collection:**
```javascript
{
  "product_id": "67890",
  "upsale": true,            // Was in tier 1 search_results
  "tier2Product": false,     // No tier 2 record exists yet
  "tier2Upsell": false       // Not a tier 2 upsell
}
```

**Console logs:**
```
[SEARCH-TO-CART] 🧬 No tier 2 record found for query: "יין אדום"
```

**Analysis**: User added a tier 1 product before tier 2 was triggered. Standard conversion.

---

### Scenario 3: Product in Both Tier 1 AND Tier 2 (Overlap)

**User Journey:**
1. User searches "יין אדום"
2. Tier 1 returns: `["Barkan Merlot", "Carmel Cabernet", "Golan Heights Syrah"]`
3. User loads more
4. Tier 2 also includes "Golan Heights Syrah" (appeared in both)
5. User adds "Golan Heights Syrah" to cart

**Result in cart collection:**
```javascript
{
  "product_id": "11111",
  "upsale": true,            // Was in tier 1 search_results
  "tier2Product": true,      // Also found in tier2_tracking
  "tier2Upsell": false       // ❌ Not counted as tier 2 upsell (was in tier 1 first)
}
```

**Analysis**: Product appeared in both tiers. We don't count this as a tier 2 upsell since the user saw it in tier 1 first.

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
- [x] Create tier2_tracking collection with TTL index
- [x] Implement automatic storage in /search/load-more endpoint
- [x] Implement automatic detection logic in /search-to-cart endpoint
- [x] Add comprehensive logging for tier 2 upsells
- [x] No client changes required (fully server-side)
- [ ] Create analytics dashboard for tier 2 metrics
- [ ] Set up monitoring alerts for tier 2 conversion rates
- [ ] A/B test tier 2 effectiveness across different query types

## Server Logs to Monitor

When tier 2 is active, you'll see these logs:

**During load-more (tier 2 storage):**
```
[load-more-xxxxx] 🧬 Stored 15 tier 2 products for query: "יין אדום יבש"
```

**During cart-add (tier 2 detection):**
```
[SEARCH-TO-CART] 🧬 Tier 2 AUTO-DETECTION: product_name="Dalton Petit Verdot", in_tier2=true, tier2_upsell=true, tier2_count=15
[SEARCH-TO-CART] ✅ TIER 2 UPSELL DETECTED: Product "Dalton Petit Verdot" added to cart from embedding similarity results (query: "יין אדום יבש")
```

**When no tier 2 record exists:**
```
[SEARCH-TO-CART] 🧬 No tier 2 record found for query: "יין אדום"
```
