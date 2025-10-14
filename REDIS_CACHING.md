# Redis Caching Implementation Guide

## Overview

This server now uses **Redis** as the primary caching layer, replacing the previous in-memory NodeCache implementation. Redis provides:

- ✅ **Distributed Caching**: Share cache across multiple server instances
- ✅ **Persistence**: Cache survives server restarts (when Redis is configured for persistence)
- ✅ **Scalability**: Handle millions of keys efficiently
- ✅ **Production-Ready**: Battle-tested caching solution
- ✅ **Advanced Features**: TTL, pattern matching, atomic operations

## Setup

### 1. Install Redis

#### macOS (using Homebrew)
```bash
brew install redis
brew services start redis
```

#### Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

#### Docker
```bash
docker run -d --name redis -p 6379:6379 redis:latest
```

### 2. Configure Environment Variables

Copy the example environment file:
```bash
cp env.example .env
```

Edit `.env` and set your Redis URL:
```bash
# For local Redis
REDIS_URL=redis://localhost:6379

# For Redis Cloud (example)
REDIS_URL=redis://default:your-password@redis-12345.cloud.redislabs.com:12345

# For TLS/SSL connection
REDIS_URL=rediss://default:your-password@secure-redis.cloud.com:6380
```

### 3. Install Dependencies

The Redis client is already in `package.json`. If you need to reinstall:
```bash
npm install
```

### 4. Start the Server

```bash
node server.js
```

You should see:
```
[REDIS] Connecting...
[REDIS] Ready and connected successfully
[REDIS] Initial connection successful
Server is running on port 8000
Redis URL: redis://localhost:6379
```

## Architecture

### Connection Management

- **Automatic Reconnection**: Exponential backoff with up to 10 retry attempts
- **Connection Pooling**: Managed by the Redis client
- **Graceful Shutdown**: Properly closes Redis connections on server termination
- **Error Handling**: Server continues functioning even if Redis is unavailable

### Caching Strategy

#### 1. Cache Wrapper Function
```javascript
withCache(cacheKey, fn, ttl)
```
- Checks Redis for cached data
- If cache miss, executes function and stores result
- Automatic JSON serialization/deserialization
- Configurable TTL (Time To Live)

#### 2. Cache Invalidation
```javascript
invalidateCache(pattern)  // Invalidate by pattern
invalidateCacheKey(key)   // Invalidate specific key
clearAllCache()           // Clear entire cache
```

## API Endpoints

### Health Check
```bash
GET /health
```

Returns Redis and MongoDB connection status:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-14T10:30:00.000Z",
  "uptime": 3600,
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

### Cache Statistics
```bash
GET /cache/stats
```

Returns detailed Redis statistics:
```json
{
  "redis": {
    "connected": true,
    "ready": true,
    "url": "redis://localhost:6379",
    "dbSize": 1247,
    "version": "7.0.12",
    "uptime": "24h 15m",
    "usedMemory": "8.23M",
    "connectedClients": "5",
    "keyspaceHits": "45231",
    "keyspaceMisses": "3421",
    "hitRate": "92.96%"
  }
}
```

### List Cache Keys
```bash
GET /cache/keys?pattern=translate*&limit=50
```

Returns all cache keys matching the pattern:
```json
{
  "success": true,
  "total": 127,
  "showing": 50,
  "hasMore": true,
  "keys": [
    { "key": "translate:abc123", "ttl": "3456s" },
    { "key": "translate:def456", "ttl": "2134s" }
  ]
}
```

### Clear Cache
```bash
POST /cache/clear
Content-Type: application/json

{
  "pattern": "translate"  // Optional: clear specific pattern
}
```

Clear all cache:
```bash
POST /cache/clear
Content-Type: application/json
{}
```

Response:
```json
{
  "success": true,
  "message": "Cleared 47 cache entries matching pattern: translate",
  "count": 47
}
```

### Delete Specific Cache Key
```bash
DELETE /cache/key/translate:abc123
```

Response:
```json
{
  "success": true,
  "message": "Cache key deleted: translate:abc123"
}
```

### Warm Cache
```bash
POST /cache/warm
```

Pre-populates cache with common queries. Automatically runs 5 seconds after server startup.

## Cache Keys

Cache keys follow a structured naming convention:

| Prefix | Purpose | Example | TTL |
|--------|---------|---------|-----|
| `translate:*` | Query translations | `translate:abc123...` | 1 hour |
| `complexity:*` | Query complexity classification | `complexity:def456...` | 1 hour |
| `search:*` | Search results | `search:ghi789...` | 30 min |
| `embed:*` | Vector embeddings | `embed:jkl012...` | 24 hours |

Keys are hashed using MD5 to ensure consistent length and valid Redis key format.

## Performance Tips

### 1. Optimal TTL Values

```javascript
// Short-lived data (search results)
await withCache(key, fn, 1800);  // 30 minutes

// Medium-lived data (translations)
await withCache(key, fn, 3600);  // 1 hour

// Long-lived data (embeddings)
await withCache(key, fn, 86400); // 24 hours
```

### 2. Cache Warming

Warm up cache for common queries on startup or during low-traffic periods:
```javascript
POST /cache/warm
```

### 3. Monitor Cache Hit Rate

Regularly check `/cache/stats` to monitor hit rate. Aim for >80% hit rate:
```bash
curl http://localhost:8000/cache/stats | jq '.redis.hitRate'
```

### 4. Pattern-Based Invalidation

When data changes, invalidate related cache entries:
```javascript
// Product updated - invalidate all product-related caches
await invalidateCache('product');

// Translation model updated - clear translation cache
await invalidateCache('translate');
```

## Production Deployment

### Redis Cloud Options

1. **Redis Cloud** (https://redis.com/cloud/)
   - Managed Redis service
   - Free tier available
   - Auto-scaling and high availability

2. **AWS ElastiCache**
   - Fully managed Redis
   - VPC integration
   - Automated backups

3. **Azure Cache for Redis**
   - Enterprise-grade caching
   - Built-in monitoring

4. **Google Cloud Memorystore**
   - Managed Redis on GCP
   - Automatic failover

### Configuration for Production

```bash
# Use TLS for encrypted connections
REDIS_URL=rediss://default:password@your-redis.cloud.com:6380

# Enable Redis persistence (in Redis config)
appendonly yes
appendfsync everysec
```

### Monitoring

Set up alerts for:
- Redis connection failures
- Cache hit rate < 80%
- Memory usage > 80%
- Response time degradation

### Scaling

For high-traffic applications:
1. Use Redis Cluster for horizontal scaling
2. Enable Redis persistence (AOF + RDB)
3. Set up Redis Sentinel for high availability
4. Configure connection pooling limits
5. Use separate Redis instances for different data types

## Troubleshooting

### Redis Connection Fails

```bash
# Check if Redis is running
redis-cli ping
# Should return: PONG

# Check Redis connection
redis-cli -u redis://localhost:6379 ping

# Check logs
tail -f /var/log/redis/redis-server.log  # Linux
brew services restart redis              # macOS
```

### Server Works Without Redis

The server gracefully degrades when Redis is unavailable:
- Cache operations are bypassed
- All functions continue to work (without caching)
- Health endpoint shows degraded status

### Clear Stuck Cache

```bash
# Clear all cache
curl -X POST http://localhost:8000/cache/clear \
  -H "Content-Type: application/json" \
  -d '{}'

# Clear specific pattern
curl -X POST http://localhost:8000/cache/clear \
  -H "Content-Type: application/json" \
  -d '{"pattern": "translate"}'
```

### Memory Issues

```bash
# Check Redis memory usage
redis-cli INFO memory

# Set maxmemory and eviction policy (in redis.conf)
maxmemory 2gb
maxmemory-policy allkeys-lru  # Evict least recently used keys
```

## Migration from NodeCache

The server has been fully migrated from NodeCache to Redis. The old `node-cache` package has been removed from dependencies.

### Key Changes:
- ✅ All caching now uses Redis
- ✅ No in-memory cache layer
- ✅ SCAN used instead of KEYS for production safety
- ✅ Improved error handling and logging
- ✅ Better cache statistics and monitoring

### What Stayed the Same:
- `withCache()` function signature unchanged
- Cache key generation logic preserved
- TTL behavior consistent

## Best Practices

1. **Always set appropriate TTLs** - Don't cache forever
2. **Use SCAN instead of KEYS** - Already implemented in `invalidateCache()`
3. **Monitor memory usage** - Use `/cache/stats` endpoint
4. **Invalidate stale data** - Clear cache when source data changes
5. **Handle Redis failures gracefully** - Server works without cache
6. **Use connection pooling** - Already configured
7. **Enable persistence** - For production deployments
8. **Use namespaced keys** - Implemented with prefix system
9. **Log cache operations** - Already logging hits/misses
10. **Regular health checks** - Use `/health` endpoint

## Example Usage in Code

```javascript
// Cache a database query
const products = await withCache(
  generateCacheKey('products', userId, category),
  async () => {
    return await db.collection('products').find({ category }).toArray();
  },
  3600 // 1 hour TTL
);

// Cache an API call
const translation = await withCache(
  generateCacheKey('translate', query, language),
  async () => {
    return await translateAPI.translate(query, language);
  },
  7200 // 2 hours TTL
);

// Invalidate cache when data changes
app.post('/products/:id', async (req, res) => {
  // Update product
  await updateProduct(req.params.id, req.body);
  
  // Clear related caches
  await invalidateCache('products');
  
  res.json({ success: true });
});
```

## Support

For issues or questions:
1. Check Redis connection: `redis-cli ping`
2. Check server logs for `[REDIS]` and `[CACHE]` messages
3. Use `/health` endpoint to verify Redis status
4. Check `/cache/stats` for performance metrics

---

**Last Updated**: October 14, 2025
**Redis Client Version**: 5.8.2
**Node.js Version**: 14+

