# Memory Optimization Guide 🚀

## Problem
The server was experiencing frequent Out of Memory (OOM) crashes every 30 minutes due to:
- Redis reconnection attempts flooding memory
- Event listeners accumulating
- Offline queue building up in Redis client
- No garbage collection triggers

## Solutions Implemented

### 1. Redis Connection Management
**Before:** 10 reconnection attempts with long timeouts
**After:**
- ✅ Only 3 reconnection attempts
- ✅ 5-second connection timeout (down from 10s)
- ✅ Offline queue disabled (`enableOfflineQueue: false`)
- ✅ Max 10 errors logged, then silent
- ✅ Event listeners cleaned up on failure
- ✅ Max listeners set to 5

```javascript
reconnectStrategy: (retries) => {
  if (retries > 3) {
    redisConnectionFailed = true;
    return false; // Stop reconnecting
  }
  return Math.min(retries * 1000, 3000);
}
```

### 2. Memory Monitoring
**New:** Automatic memory monitoring every 30 minutes

```javascript
setInterval(() => {
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  console.log(`[MEMORY] Heap: ${heapUsedMB}MB / ${heapTotalMB}MB`);
  
  if (heapUsedMB > 400) {
    console.warn('[MEMORY WARNING] High usage');
  }
  
  if (global.gc && heapUsedMB > 300) {
    global.gc(); // Force garbage collection
  }
}, 30 * 60 * 1000);
```

### 3. Server Startup with Memory Limits
**Command:**
```bash
node --max-old-space-size=512 --expose-gc server.js
```

- `--max-old-space-size=512`: Limit heap to 512MB (prevents runaway memory)
- `--expose-gc`: Enable manual garbage collection

### 4. Auto-Restart Script
**New file:** `start-with-restart.sh`

Features:
- ✅ Automatically restarts server on crash
- ✅ Limits to 10 restarts per hour (prevents infinite loops)
- ✅ Logs restart times and exit codes
- ✅ Runs with memory limits enabled

**Usage:**
```bash
chmod +x start-with-restart.sh
./start-with-restart.sh
```

### 5. Cache Warming Skip
**Before:** Always tried to warm cache, even without Redis
**After:**
```javascript
async function warmCache() {
  if (!redisClient || !redisReady || redisConnectionFailed) {
    console.log('[CACHE WARM] Skipping - Redis not available');
    return;
  }
  // ... warm cache logic
}
```

## Monitoring Commands

### Check Memory Usage
```bash
# Real-time memory monitoring
node -e "setInterval(() => console.log(process.memoryUsage()), 5000)"

# Check server memory
ps aux | grep "node server.js"
```

### Check for Memory Leaks
```bash
# Install clinic
npm install -g clinic

# Run with memory profiling
clinic doctor -- node --max-old-space-size=512 server.js

# Check heap snapshots
node --inspect server.js
# Then open chrome://inspect in Chrome
```

### Monitor Logs
```bash
# Watch memory logs
tail -f server.log | grep MEMORY

# Watch Redis errors
tail -f server.log | grep REDIS

# Count OOM crashes
grep "out of memory" server.log | wc -l
```

## Production Recommendations

### 1. Use PM2 for Process Management
```bash
npm install -g pm2

# Start with PM2
pm2 start server.js --name dashboard-server \
  --node-args="--max-old-space-size=512 --expose-gc" \
  --max-memory-restart 450M

# Monitor
pm2 monit

# Auto-restart on crash
pm2 startup
pm2 save
```

### 2. Set Up Alerts
Configure alerts for:
- Memory usage > 400MB
- Restart count > 5 per hour
- Redis connection failures
- Slow response times (> 2s)

### 3. Redis Configuration
If using Redis:
```bash
# Set maxmemory policy in redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru

# Enable persistence
appendonly yes
appendfsync everysec
```

If NOT using Redis:
```bash
# Comment out or remove REDIS_URL from .env
# REDIS_URL=redis://...
```

### 4. Database Connection Pooling
Current MongoDB pool settings:
```javascript
maxPoolSize: 50      // Max connections
minPoolSize: 10      // Min connections to keep alive
maxIdleTimeMS: 30000 // Close idle after 30s
```

For lower memory usage, reduce:
```javascript
maxPoolSize: 20      // Reduce max connections
minPoolSize: 5       // Reduce min connections
```

## Troubleshooting

### Server Still Crashes?

1. **Check logs for patterns:**
```bash
grep -B5 "out of memory" server.log
```

2. **Reduce concurrent operations:**
```javascript
// In server.js, reduce these limits:
const searchLimit = 5;        // Down from 10
const vectorLimit = 15;       // Down from 30
const emergencyLimit = 10;    // Down from 15
```

3. **Disable heavy features temporarily:**
```javascript
// Skip emergency expansion
const shouldTriggerEmergencyExpansion = false;

// Reduce reranking products
maxResults = 8  // Down from 12
```

4. **Increase memory limit (if server has RAM):**
```bash
node --max-old-space-size=1024 server.js  # 1GB instead of 512MB
```

### Monitor Specific Routes
```javascript
// Add memory logging to heavy routes
app.post("/search", async (req, res) => {
  const memBefore = process.memoryUsage().heapUsed;
  // ... search logic ...
  const memAfter = process.memoryUsage().heapUsed;
  console.log(`[MEMORY] /search used ${Math.round((memAfter - memBefore) / 1024 / 1024)}MB`);
});
```

## Expected Behavior After Fixes

✅ Redis stops trying to reconnect after 3 failed attempts
✅ No flood of error messages in logs
✅ Memory usage stays below 512MB
✅ Garbage collection runs automatically when heap > 300MB
✅ Server continues working without Redis
✅ Automatic restart on crash (max 10 per hour)
✅ Memory logged every 30 minutes

## Current Status

- **Redis:** Disabled (connection failed, server continues without caching)
- **Memory Limit:** 512MB
- **Garbage Collection:** Enabled (`--expose-gc`)
- **Auto-Restart:** Available via `start-with-restart.sh`
- **Monitoring:** Every 30 minutes

Server should now run stable without OOM crashes! 🎉

