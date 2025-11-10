# Text Match Tiers for Simple Queries

## Overview

For simple queries (like "פיבר טרי"), search results are now tiered to clearly separate **high text matches** (products that actually contain the search term) from **related results** (vector/semantic matches).

## How It Works

### Tier Classification

**High Text Match (Tier 1):**
- Products with `exactMatchBonus >= 20,000`
- These are products where the name contains the search query
- Examples:
  - Query: "פיבר טרי" → Product: "פיבר טרי מרלו" ✅
  - Query: "Barkan" → Product: "Barkan Reserve" ✅
  - Query: "Carmel" → Product: "Carmel Selected" ✅

**Related Results (Tier 2):**
- Products with `exactMatchBonus < 20,000`
- Vector/semantic matches
- Soft category matches
- May not contain the actual search term
- Examples:
  - Query: "פיבר טרי" → Product: "יקב אחר עם סגנון דומה" (different winery, similar style)
  - Query: "Barkan" → Product: "Golan Heights" (different brand, vectorally related)

### Threshold Explanation

The `exactMatchBonus` values from `getExactMatchBonus()`:

```javascript
Exact match:              50,000  ✅ Tier 1
Cleaned exact match:      45,000  ✅ Tier 1  
Contains full query:      30,000  ✅ Tier 1
Contains cleaned query:   25,000  ✅ Tier 1
Multi-word phrase match:  20,000  ✅ Tier 1 (threshold)
No match:                      0  ❌ Tier 2
```

**Threshold = 20,000** means products with phrase matches or better are considered "high text matches".

## Response Format

### Product-Level Flag

Each product now has a `highTextMatch` boolean flag (only for simple queries):

```json
{
  "_id": "123",
  "name": "פיבר טרי מרלו",
  "price": 89,
  "highlight": false,
  "highTextMatch": true,  // ← New flag!
  "softFilterMatch": false,
  "softCategoryMatches": 0
}
```

### Metadata Tier Information

For simple queries, the response metadata includes tier statistics:

```json
{
  "products": [...],
  "pagination": {...},
  "metadata": {
    "query": "פיבר טרי",
    "requestId": "xyz123",
    "executionTime": 245,
    "tiers": {  // ← New tier info (only for simple queries)
      "hasTextMatchTier": true,
      "highTextMatches": 4,
      "otherResults": 21,
      "description": "4 high text matches, 21 related results"
    }
  }
}
```

## Usage in Frontend

### Display Separation

You can use the `highTextMatch` flag to visually separate results:

```javascript
const highTextMatches = response.products.filter(p => p.highTextMatch);
const relatedResults = response.products.filter(p => !p.highTextMatch);

// Display with visual separator
<div>
  <h3>Exact Matches ({highTextMatches.length})</h3>
  {highTextMatches.map(product => <ProductCard {...product} />)}
  
  {relatedResults.length > 0 && (
    <>
      <div className="separator">Related Results</div>
      <h3>Related Products ({relatedResults.length})</h3>
      {relatedResults.map(product => <ProductCard {...product} />)}
    </>
  )}
</div>
```

### UI Styling Ideas

**Option 1: Visual Separator**
```
┌────────────────────────┐
│ 🎯 Exact Matches (4)   │
├────────────────────────┤
│ פיבר טרי מרלו          │
│ פיבר טרי קברנה         │
│ פיבר טרי שרדונה        │
│ פיבר טרי סוביניון      │
└────────────────────────┘

┌────────────────────────┐
│ 🔗 Related (21)        │
├────────────────────────┤
│ Other products...      │
└────────────────────────┘
```

**Option 2: Badge/Border**
```css
.product-card.high-text-match {
  border: 2px solid #4CAF50;
  background: #f1f8f4;
}

.product-card.high-text-match::before {
  content: "🎯 Exact Match";
  background: #4CAF50;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}
```

**Option 3: Section Headers**
```html
<div class="results-section">
  <div class="section-header">
    <h3>Exact Matches</h3>
    <span class="count">4 products</span>
  </div>
  <!-- High text match products -->
</div>

<div class="results-section">
  <div class="section-header">
    <h3>Related Products</h3>
    <span class="count">21 products</span>
  </div>
  <!-- Related products -->
</div>
```

## Example Scenarios

### Scenario 1: Brand Search
```
Query: "פיבר טרי"
Classification: Simple

Tier 1 (highTextMatch = true):
  - פיבר טרי מרלו (exact match bonus: 50,000)
  - פיבר טרי קברנה סוביניון (contains query bonus: 30,000)
  - פיבר טרי רזרב (contains query bonus: 30,000)
  - פיבר טרי שרדונה (contains query bonus: 30,000)

Tier 2 (highTextMatch = false):
  - יקב גולן (vector match, no text match)
  - כרמל מרלו (vector match, no text match)
  - ברקן רזרב (vector match, no text match)
  ... 18 more related products

Response:
  tiers: {
    highTextMatches: 4,
    otherResults: 21,
    description: "4 high text matches, 21 related results"
  }
```

### Scenario 2: No Text Matches
```
Query: "יין יקר"
Classification: Complex (NOT simple - no tiering applied)

Result: No highTextMatch flags, no tier metadata
(Complex queries don't use text match tiers)
```

### Scenario 3: Only Text Matches
```
Query: "Barkan"
Classification: Simple

Tier 1 (highTextMatch = true):
  - Barkan Classic (exact match bonus: 50,000)
  - Barkan Reserve (contains query bonus: 30,000)
  - Barkan Altitude (contains query bonus: 30,000)
  ... 12 total

Tier 2 (highTextMatch = false):
  (empty - no related results in top 25)

Response:
  tiers: {
    highTextMatches: 15,
    otherResults: 0,
    description: "15 high text matches, 0 related results"
  }
```

## Benefits

1. **Clear Distinction**: Users immediately see which products match their query exactly
2. **Better UX**: Reduces confusion from "unrelated" vector matches
3. **Flexible Display**: Frontend can choose how to present the separation
4. **Backward Compatible**: Flag is only added for simple queries, doesn't break existing clients
5. **Metadata Rich**: Tier statistics help frontend make UI decisions

## Technical Details

### When Tiers Are Applied

- ✅ **Simple queries only** (e.g., "פיבר טרי", "Barkan", "Carmel Reserve")
- ❌ **NOT for complex queries** (e.g., "יין אדום מתאים לבשר")
- ❌ **NOT for filter-only queries**

### Performance Impact

- **Minimal**: Only adds a boolean flag calculation
- **Cost**: ~0.1ms per product (25 products = 2.5ms)
- **Benefit**: Huge UX improvement for simple queries

### Sorting Behavior

The existing sorting already prioritizes text matches for simple queries:

```
1. High text matches (50,000 bonus)
2. Multi-category soft matches
3. Single-category soft matches
4. Other results by RRF score
```

The `highTextMatch` flag simply **labels** what the sorting already prioritizes!

## Summary

**For simple queries like "פיבר טרי":**

**Tier 1 (High Text Match):**
- Products with strong text matches (`exactMatchBonus >= 20,000`)
- Marked with `highTextMatch: true`

**Tier 2 (Related Results):**
- Semantic/contextual matches only
- Soft category matches
- Marked with `highTextMatch: false`

**Response:**
- Tier statistics in `metadata.tiers`
- Frontend can display separated tiers for better UX

**Result:** Clear separation between "exact matches" and "related products"! 🎯

