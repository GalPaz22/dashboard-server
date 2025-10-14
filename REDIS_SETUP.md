# Quick Redis Setup Guide

This guide will help you get Redis up and running quickly for your dashboard server.

## Quick Start (5 minutes)

### Option 1: Local Redis (Development)

#### macOS
```bash
# Install Redis
brew install redis

# Start Redis (runs in background)
brew services start redis

# Verify it's running
redis-cli ping
# Should return: PONG

# Set environment variable (add to .env file)
echo "REDIS_URL=redis://localhost:6379" >> .env

# Start your server
node server.js
```

#### Ubuntu/Debian Linux
```bash
# Install Redis
sudo apt-get update
sudo apt-get install redis-server

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Verify it's running
redis-cli ping
# Should return: PONG

# Set environment variable (add to .env file)
echo "REDIS_URL=redis://localhost:6379" >> .env

# Start your server
node server.js
```

#### Docker
```bash
# Run Redis container
docker run -d \
  --name dashboard-redis \
  -p 6379:6379 \
  --restart unless-stopped \
  redis:7-alpine

# Verify it's running
docker exec dashboard-redis redis-cli ping
# Should return: PONG

# Set environment variable (add to .env file)
echo "REDIS_URL=redis://localhost:6379" >> .env

# Start your server
node server.js
```

### Option 2: Redis Cloud (Production)

1. **Sign up for Redis Cloud** (Free tier available)
   - Go to https://redis.com/try-free/
   - Create a free account
   - Create a new database

2. **Get your connection URL**
   - Copy the Redis URL from your dashboard
   - It will look like: `redis://default:password@redis-12345.cloud.redislabs.com:12345`

3. **Configure your server**
   ```bash
   # Add to .env file
   REDIS_URL=redis://default:YOUR_PASSWORD@YOUR_REDIS_HOST:PORT
   
   # Start your server
   node server.js
   ```

## Verify Installation

After starting your server, you should see:
```
[REDIS] Connecting...
[REDIS] Ready and connected successfully
[REDIS] Initial connection successful
Server is running on port 8000
Redis URL: redis://localhost:6379
```

Test the health endpoint:
```bash
curl http://localhost:8000/health

# Should show:
{
  "status": "healthy",
  "services": {
    "redis": {
      "connected": true,
      "status": "healthy"
    }
  }
}
```

## Common Redis Commands

```bash
# Check Redis is running
redis-cli ping

# Monitor all Redis commands in real-time
redis-cli monitor

# Get number of keys
redis-cli DBSIZE

# View all keys (use sparingly in production!)
redis-cli KEYS "*"

# View keys with pattern
redis-cli KEYS "translate:*"

# Get a specific key value
redis-cli GET "your-key-here"

# Delete a key
redis-cli DEL "your-key-here"

# Clear all data (careful!)
redis-cli FLUSHALL

# Get Redis info
redis-cli INFO

# Get memory stats
redis-cli INFO memory
```

## Testing Your Cache

```bash
# 1. Check cache stats (should show 0 keys initially)
curl http://localhost:8000/cache/stats

# 2. Make a request that will be cached (example)
curl "http://localhost:8000/autocomplete?query=wine"

# 3. Check cache stats again (should show keys now)
curl http://localhost:8000/cache/stats

# 4. List all cache keys
curl "http://localhost:8000/cache/keys?limit=10"

# 5. Clear specific cache pattern
curl -X POST http://localhost:8000/cache/clear \
  -H "Content-Type: application/json" \
  -d '{"pattern": "translate"}'

# 6. Clear all cache
curl -X POST http://localhost:8000/cache/clear \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Troubleshooting

### "Redis Client Error" in logs

**Problem**: Server can't connect to Redis

**Solutions**:
```bash
# 1. Check if Redis is running
redis-cli ping

# 2. Start Redis if not running
brew services start redis        # macOS
sudo systemctl start redis-server  # Linux
docker start dashboard-redis     # Docker

# 3. Check your REDIS_URL in .env
cat .env | grep REDIS_URL
```

### "Connection refused"

**Problem**: Redis is not running or wrong port

**Solutions**:
```bash
# Check what's running on port 6379
lsof -i :6379  # macOS/Linux
netstat -an | grep 6379  # Windows

# Try connecting manually
redis-cli -h localhost -p 6379 ping

# Check Redis logs
tail -f /var/log/redis/redis-server.log  # Linux
brew services restart redis              # macOS
docker logs dashboard-redis              # Docker
```

### Server works but no caching

**Problem**: Redis connected but cache not working

**Solutions**:
```bash
# 1. Check health endpoint
curl http://localhost:8000/health

# 2. Check server logs for [CACHE] messages
# You should see [CACHE HIT] or [CACHE MISS] messages

# 3. Monitor Redis commands
redis-cli monitor
# Then make a request and watch for SET/GET commands

# 4. Check if keys are being created
redis-cli DBSIZE
```

### Out of memory

**Problem**: Redis runs out of memory

**Solutions**:
```bash
# 1. Check memory usage
redis-cli INFO memory

# 2. Clear cache
curl -X POST http://localhost:8000/cache/clear \
  -H "Content-Type: application/json" \
  -d '{}'

# 3. Configure maxmemory (edit redis.conf)
maxmemory 2gb
maxmemory-policy allkeys-lru

# 4. Restart Redis
brew services restart redis  # macOS
sudo systemctl restart redis-server  # Linux
```

## Performance Monitoring

Monitor your cache performance regularly:

```bash
# Get detailed stats
curl http://localhost:8000/cache/stats | jq

# Watch for important metrics:
# - hitRate: Should be > 80%
# - dbSize: Total cached keys
# - usedMemory: Memory consumption

# Set up a simple monitor script (optional)
watch -n 5 'curl -s http://localhost:8000/cache/stats | jq ".redis.hitRate"'
```

## Production Checklist

Before deploying to production:

- [ ] Redis is running and accessible
- [ ] REDIS_URL is set in .env
- [ ] Health endpoint returns "healthy"
- [ ] Cache stats endpoint works
- [ ] Hit rate is > 80% after warming
- [ ] Memory limit is configured
- [ ] Eviction policy is set (allkeys-lru)
- [ ] Redis persistence is enabled (AOF or RDB)
- [ ] Monitoring/alerts are configured
- [ ] Backup strategy is in place

## Need Help?

1. Check the full documentation: `REDIS_CACHING.md`
2. View server logs for [REDIS] and [CACHE] messages
3. Test connection: `redis-cli ping`
4. Check health: `curl http://localhost:8000/health`

---

**Quick Reference URLs**:
- Health Check: http://localhost:8000/health
- Cache Stats: http://localhost:8000/cache/stats
- Cache Keys: http://localhost:8000/cache/keys
- Clear Cache: POST http://localhost:8000/cache/clear

