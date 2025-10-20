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

**Response:**
```json
{
  "products": [
    // First 20 products
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
    // Next 20 products
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

## 📊 **Pagination Details**

- **First batch**: 20 products (immediate)
- **Second batch**: 20 products (auto-loaded, cached for 60s)
- **Manual pagination**: Products 41-65 (via `/search/load-more`)
- **Maximum per search**: 65 products total

---

**Server URL**: `http://localhost:8000`  
**API Key**: `semantix_688736e523c0352ad78525fe_1753691812345`

