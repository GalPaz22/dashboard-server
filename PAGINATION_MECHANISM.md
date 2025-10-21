# Intelligent Pagination Mechanism

## 🎯 Overview

This server implements an **intelligent, performance-optimized pagination system** where each batch performs a **fresh, independent search** for exactly 20 products.

## 🚀 How It Works

### **Batch 1: Initial Search** (Manual)
1. User submits search query
2. Server performs search with limit of **20-35 products** from DB
3. Returns **exactly 20 products** immediately
4. Response includes `secondBatchToken` with all search context

**Speed**: Fast! Only fetches what's needed.

### **Batch 2: Auto-Load** (Automatic)
1. Frontend automatically calls `/search/auto-load-more` after 500ms
2. Server performs **fresh search** using saved parameters
3. **Excludes** the 20 products already delivered (using `deliveredIds`)
4. Returns **next 20 different products**
5. Response includes `nextToken` for manual load-more

**Speed**: Fast! Independent search for next 20.

### **Batch 3+: Manual Load More** (On-Demand)
1. User clicks "Load More" button
2. Same process as Batch 2
3. Each batch fetches **next 20 unique products**
4. Continues until no more results

## 📊 Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     INITIAL SEARCH                            │
│  POST /search                                                 │
│  ├─ Search DB (fuzzy + vector, limit ~30-35)                │
│  ├─ Apply RRF scoring                                        │
│  ├─ Sort by relevance                                        │
│  └─ Return first 20 products                                 │
│     ├─ products: [20 items]                                  │
│     └─ pagination: {                                         │
│           secondBatchToken: "<search_params + delivered_ids>  │
│         }                                                     │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│                   AUTO-LOAD BATCH 2                           │
│  GET /search/auto-load-more?token=...                       │
│  ├─ Decode token → get search params + deliveredIds [20]    │
│  ├─ Perform FRESH search (fuzzy + vector, limit ~30-35)     │
│  ├─ Filter out deliveredIds                                 │
│  └─ Return next 20 products                                 │
│     ├─ products: [20 items]                                  │
│     └─ pagination: {                                         │
│           nextToken: "<params + delivered_ids [40]>"         │
│         }                                                     │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│              MANUAL LOAD MORE (Batch 3+)                      │
│  GET /search/auto-load-more?token=...                       │
│  ├─ Decode token → get search params + deliveredIds [40]    │
│  ├─ Perform FRESH search                                    │
│  ├─ Filter out deliveredIds                                 │
│  └─ Return next 20 products                                 │
│     └─ Updates deliveredIds for next batch                  │
└──────────────────────────────────────────────────────────────┘
```

## 🎁 Benefits

### **1. Performance** ⚡
- Each search fetches **only 20-35 products** from MongoDB
- No pre-fetching of 40+ products
- Fast response times (<200ms typical)

### **2. Freshness** 🔄
- Each batch is a **fresh search**
- Captures any DB updates between batches
- No stale cached data

### **3. Scalability** 📈
- Minimal memory usage (no large caches)
- Efficient DB queries (small limits)
- Works with thousands of products

### **4. Accuracy** 🎯
- **Tracks delivered IDs** to prevent duplicates
- Ensures unique products in each batch
- Maintains relevance ranking across batches

## 🔧 Technical Details

### **Token Structure**

Each `secondBatchToken` or `nextToken` contains:

```json
{
  "query": "יין אדום",
  "filters": {
    "category": "red",
    "type": "wine"
  },
  "deliveredIds": ["id1", "id2", ..., "id20"],
  "batchNumber": 2,
  "dbName": "manoVino",
  "collectionName": "products",
  "context": "wine store",
  "categories": "...",
  "types": "...",
  "softCategories": "...",
  "noWord": [...],
  "noHebrewWord": [...],
  "syncMode": "text",
  "explain": true,
  "timestamp": 1234567890
}
```

### **Search Process Per Batch**

1. **Decode Token** → Extract search parameters + deliveredIds
2. **Translate Query** → Hebrew to English (cached)
3. **Extract Filters** → Hard/soft categories (cached)
4. **Clean Text** → Remove filter words
5. **Get Embedding** → Vector representation (cached)
6. **Execute Search** → MongoDB aggregation pipelines
   - Fuzzy search (limit: 35)
   - Vector search (limit: 35)
   - Soft category sweep (if applicable)
7. **Apply RRF** → Combine and rank results
8. **Sort** → Soft category priority
9. **Filter** → Remove deliveredIds
10. **Slice** → Take next 20 products
11. **Return** → With updated nextToken

### **Caching Strategy**

Smart caching for performance:
- ✅ **Translation cache**: 1 week TTL
- ✅ **Embedding cache**: 1 week TTL
- ✅ **Filter extraction cache**: 1 week TTL
- ❌ **NO result caching**: Always fresh

## 📱 Frontend Integration

### **Example Flow**

```javascript
// 1. Initial search
const response = await fetch('/search', {
  method: 'POST',
  body: JSON.stringify({ query: 'יין אדום' })
});
const data = await response.json();
// Returns: 20 products + secondBatchToken

// 2. Auto-load batch 2 (automatic after 500ms)
if (data.pagination.autoLoadMore) {
  setTimeout(async () => {
    const batch2 = await fetch(
      `/search/auto-load-more?token=${data.pagination.secondBatchToken}`
    );
    const data2 = await batch2.json();
    // Returns: 20 MORE products + nextToken
  }, 500);
}

// 3. Manual load more (user clicks button)
const batch3 = await fetch(
  `/search/auto-load-more?token=${data2.pagination.nextToken}`
);
const data3 = await batch3.json();
// Returns: 20 MORE products + nextToken (if hasMore)
```

## 🎯 Response Format

### **Initial Search** (`POST /search`)

```json
{
  "products": [...20 products...],
  "pagination": {
    "hasMore": true,
    "totalAvailable": 67,
    "returned": 20,
    "batchNumber": 1,
    "autoLoadMore": true,
    "secondBatchToken": "eyJ...",
    "nextToken": "eyJ..."
  },
  "metadata": {
    "query": "יין אדום",
    "requestId": "abc123",
    "executionTime": 156
  }
}
```

### **Auto-Load More** (`GET /search/auto-load-more`)

```json
{
  "products": [...20 products...],
  "pagination": {
    "hasMore": true,
    "returned": 20,
    "batchNumber": 2,
    "totalDelivered": 40,
    "nextToken": "eyJ..."
  },
  "metadata": {
    "query": "יין אדום",
    "requestId": "def456",
    "executionTime": 142,
    "freshSearch": true,
    "excludedCount": 20
  }
}
```

## ⚙️ Configuration

### **Batch Size**
```javascript
const BATCH_SIZE = 20; // Products per batch
```

### **Search Limits**
```javascript
const searchLimit = 35;  // Fuzzy search limit
const vectorLimit = 35;  // Vector search limit
```

These limits ensure:
- Good RRF scoring quality
- Fast query execution
- Enough products after filtering deliveredIds

### **Token Expiry**
```javascript
const TOKEN_EXPIRY = 120000; // 2 minutes
```

## 🔍 Search Quality

Despite fetching only 20-35 products per batch, search quality remains high because:

1. **RRF Scoring**: Works well with 30-40 products
2. **Soft Category Boosting**: Applied consistently
3. **Multi-Category Priority**: Maintained across batches
4. **Exact Match Detection**: Still catches exact matches
5. **LLM Reordering**: Applied to initial search

## 🎉 Summary

This pagination mechanism provides:
- ⚡ **Fast** response times
- 🎯 **Accurate** results (no duplicates)
- 🔄 **Fresh** data per batch
- 📈 **Scalable** architecture
- 💡 **Smart** caching strategy

Perfect for delivering a smooth, responsive search experience!

