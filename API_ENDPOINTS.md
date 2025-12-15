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
  "query": "wine",
  "context": "wine store",
  "useImages": false,
  "example": "",
  "noWord": "",
  "noHebrewWord": ""
}
```

**Note:** The search behavior is customized per API key through user configuration in MongoDB.

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
    query: 'wine',
    context: 'wine store'
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

## ⚙️ **User Configuration (MongoDB)**

Each API key is associated with a user document in MongoDB that contains configuration settings. These settings customize the search behavior for your specific industry and use case.

### **Configuration Fields**

The user document in the `users` collection supports the following fields:

```json
{
  "apiKey": "semantix_688736e523c0352ad78525fe_1753691812345",
  "dbName": "your_database_name",
  "collections": {
    "products": "products",
    "queries": "queries"
  },
  "credentials": {
    "categories": "category1,category2,category3",
    "type": "type1,type2,type3",
    "softCategories": "attr1,attr2,attr3",
    "softCategoriesBoosted": {
      "attr1": 2.0,
      "attr2": 1.5,
      "attr3": 1.0
    }
  },
  "context": "wine store",
  "classifyPrompt": "Custom industry-specific prompt for filter extraction (optional)",
  "syncMode": "text",
  "explain": false,
  "limit": 25
}
```

### **Industry-Specific Filter Extraction with `classifyPrompt`**

The `classifyPrompt` field allows you to customize the AI-powered filter extraction system for your specific industry:

**Default Behavior (Alcohol/Beverages):**
- If `classifyPrompt` is **not set** or is `null`, the system uses the default prompt optimized for wine and alcohol e-commerce
- The default prompt includes domain knowledge about wine brands, grape varieties, regions, spirits, and wine characteristics

**Custom Industry Prompts:**
- Set `classifyPrompt` in your user document to customize filter extraction for other industries
- The prompt should describe your industry's domain knowledge and product characteristics
- Example for fashion industry:
  ```json
  {
    "classifyPrompt": "You are an expert at extracting structured data from e-commerce search queries for online fashion stores. You have knowledge of: fashion brands, clothing types, materials, styles, seasons, occasions, and color patterns."
  }
  ```
- Example for electronics:
  ```json
  {
    "classifyPrompt": "You are an expert at extracting structured data from e-commerce search queries for electronics stores. You have knowledge of: device brands, specifications, compatibility, technology standards, and use cases."
  }
  ```

**How to Set `classifyPrompt`:**

Update your user document in MongoDB:
```javascript
db.users.updateOne(
  { apiKey: "your-api-key" },
  { $set: { classifyPrompt: "Your custom industry prompt here" } }
)
```

Or remove it to use the default alcohol/beverages prompt:
```javascript
db.users.updateOne(
  { apiKey: "your-api-key" },
  { $unset: { classifyPrompt: "" } }
)
```

---

## 📊 **Pagination Details**

- **First batch**: 20 products (immediate)
- **Second batch**: 20 products (auto-loaded, cached for 60s)
- **Manual pagination**: Products 41-65 (via `/search/load-more`)
- **Maximum per search**: 65 products total

---

**Server URL**: `http://localhost:8000`  
**API Key**: `semantix_688736e523c0352ad78525fe_1753691812345`

