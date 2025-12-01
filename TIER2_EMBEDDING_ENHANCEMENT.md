# Tier 2 Product Embedding Enhancement

## Overview
Enhanced tier 2 results for complex queries by adding **product embedding similarity search** alongside existing soft category filtering.

## Problem
Previously, tier 2 only used:
1. Query embedding → find products similar to the **query text**
2. Soft category matches from LLM-selected products

This missed an opportunity: if tier 1 found exact/near-exact textual matches (like "ליקר סאוטרן קומפורט" for query "סאוזן קומפורט"), tier 2 should find products **similar to those perfect matches**, not just similar to the original query.

## Solution

### Tier 1 Enhancement (Lines 5846-5882)
When preparing the tier-2 pagination token for complex queries:

1. **Identify high-quality textual matches** with `exactMatchBonus >= 50,000`
   - These are near-exact or exact product name matches
   - Take top 3 matches

2. **Fetch product embeddings** from MongoDB
   - Get full product documents including `embedding` field
   - Store in `extractedFromLLM.topProductEmbeddings`

3. **Pass to tier 2 via pagination token**
   - Embeddings included in the encoded token
   - Available for load-more requests

### Tier 2 Enhancement (Lines 3886-3955)
When serving tier 2 results:

1. **Check for product embeddings** in `extractedCategories.topProductEmbeddings`

2. **Run ANN search for each seed product**
   - Use `$vectorSearch` with product embedding as query vector
   - Apply hard category filters (e.g., "יין אדום" only)
   - Exclude seed product itself
   - Get top 20 similar products per seed

3. **Merge with existing results**
   - Create unified result map by product ID
   - Mark sources: `['soft_category']`, `['product_similarity']`, or both
   - Products found via **BOTH methods** get highest boost (5000)
   - Products found only via similarity get moderate boost (2500)

4. **Re-rank combined results**
   - Products matching both criteria rank highest
   - Provides diverse but relevant alternatives

## Benefits

### 1. Better Relevance
- If user searches "סאוזן קומפורט" and tier 1 finds "ליקר סאוטרן קומפורט"
- Tier 2 will find liqueurs **similar to that product** (other liqueurs with similar flavor profiles)
- Not just "any liqueur matching soft categories"

### 2. Semantic Understanding
- Leverages pre-computed product embeddings
- Captures flavor profiles, characteristics, regions, styles
- Goes beyond keyword/category matching

### 3. Respects Filters
- Still applies hard category constraints
- If query is "יין אדום ישראלי חצי יבש", tier 2 will only show "יין אדום"
- Semantic similarity WITHIN the correct category

### 4. Dual-Source Boosting
- Products found via BOTH soft categories AND embedding similarity get highest priority
- These are the most confident recommendations

## Example Flow

### Query: "סאוזן קומפורט"

**Tier 1 (First 25 results):**
- LLM reorders to put "ליקר סאוטרן קומפורט" at #1 (exact match)
- Extracts soft categories: ["ליקר", "מתוק", "ארה״ב"]
- **NEW:** Saves embedding of "ליקר סאוטרן קומפורט"

**Tier 2 (Next 25 results):**
- Query embedding search → finds "ליקר", sweet spirits
- Soft category search → finds ["ליקר", "מתוק", "ארה״ב"] matches
- **NEW:** Product embedding search → finds products similar to "ליקר סאוטרן קומפורט"
  - Other whiskey liqueurs
  - Similar flavor profiles
  - Similar price ranges
  - Similar use cases

**Merge & Rank:**
- Products matching soft categories + similar to seed product: **HIGHEST** (boost: 5000)
- Products only similar to seed product: **HIGH** (boost: 2500)
- Products only matching soft categories: **MODERATE** (existing RRF score)

## Technical Details

### Threshold
- `exactMatchBonus >= 50,000` = exact/near-exact product name match
- This is the "perfect textual match" tier from the textual match system

### Limits
- Top 3 textual matches used as seeds
- 20 similar products per seed (max 60 from similarity)
- Combined with soft category results (typically 60-90)
- Total tier 2 pool: ~120-150 products before deduplication

### Performance
- Product embeddings already exist in database
- ANN search is fast (indexed)
- Parallel searches for multiple seeds
- Minimal latency impact (<200ms typically)

## Logging

New log messages to monitor the feature:

```
🧬 Found 2 high-quality textual matches for embedding similarity
🧬 Extracted 2 product embeddings for tier-2 similarity search
🧬 TIER-2 ENHANCEMENT: Finding products similar to 2 high-quality tier-1 matches
🧬 Found 38 products via embedding similarity to tier-1 matches
🧬 TIER-2 MERGED: 127 total products (soft category + similarity)
🧬 Products found via BOTH methods: 12
```

## Future Enhancements

### 1. Adaptive Threshold
- Adjust `exactMatchBonus >= 50,000` based on query complexity
- Simple queries: higher threshold (fewer seeds, more precision)
- Complex queries: lower threshold (more seeds, more diversity)

### 2. Weighted Seed Products
- Give more weight to #1 match vs #3 match
- Blend embeddings: 50% seed #1 + 30% seed #2 + 20% seed #3

### 3. Negative Examples
- Use low-ranking tier 1 products as negative signals
- "Find products similar to A but NOT similar to B"

### 4. Price Range Awareness
- If seed products are $50-80, tier 2 should prioritize similar price range
- Add price filter to embedding search

## Backward Compatibility
- Feature only activates when `topProductEmbeddings` exists in pagination token
- Existing tier 2 requests continue to work unchanged
- No breaking changes to API response format

