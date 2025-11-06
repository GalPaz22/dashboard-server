# AI Fallback System Documentation

## Overview

The AI Fallback System protects your search API from AI model failures (like rate limits, API key issues, or service outages) by automatically switching to rule-based alternatives. Your search will continue working even when Gemini AI is unavailable.

## Circuit Breaker Pattern

### How It Works

The system uses a **circuit breaker** pattern to detect and respond to AI failures:

1. **Normal Operation (Circuit CLOSED)**: AI models are called normally
2. **Failure Detection**: Each failed AI call increments a failure counter
3. **Circuit Opens**: After **3 consecutive failures**, the circuit breaker opens
4. **Fallback Mode**: While open, all AI calls are bypassed and fallbacks are used
5. **Auto-Reset**: After **60 seconds**, the circuit automatically resets and tries AI again

### Circuit Breaker States

```
CLOSED (Normal)
   ↓ (3 failures)
OPEN (Using Fallbacks)
   ↓ (60 seconds)
HALF-OPEN (Testing)
   ↓ (success → CLOSED, failure → OPEN)
```

## Fallback Mechanisms

### 1. Query Classification Fallback

**AI Method** (when available):
- Uses Gemini to intelligently classify queries as "simple" or "complex"
- Considers context, intent, and linguistic patterns

**Rule-Based Fallback** (when AI unavailable):
```javascript
// Simple if:
// - 1-3 words
// - No complex indicators (e.g., "suitable for", "recommended", price ranges)
// - No contextual prepositions

Examples:
"יין ברקן" → SIMPLE
"Carmel wine" → SIMPLE
"wine for dinner around 100 shekel" → COMPLEX
"יין מתאים לארוחת ערב" → COMPLEX
```

### 2. Filter Extraction Fallback

**AI Method** (when available):
- Gemini extracts structured filters (price, category, type, softCategory)
- Validates against provided lists
- Handles synonyms and flexible matching

**Rule-Based Fallback** (when AI unavailable):
```javascript
// Extracts price information using regex patterns:

Patterns:
- "ב-100" or "באיזור ה-100" → price: 100
- "מ-50" or "החל מ-50" → minPrice: 50
- "עד 200" → maxPrice: 200
- "50-200" or "50 to 200" → minPrice: 50, maxPrice: 200

Note: Categories and types are NOT extracted in fallback mode
```

### 3. LLM Reordering Fallback

**AI Method** (when available):
- Gemini re-ranks search results based on query intent
- Considers soft categories, context, and relevance

**Fallback** (when AI unavailable):
- Skip LLM reordering entirely
- Use RRF (Reciprocal Rank Fusion) scores only
- Results are still sorted by relevance (text matches, soft categories, RRF)

## Monitoring & Control

### Check System Health

```bash
curl http://localhost:3011/health
```

**Response includes circuit breaker status:**
```json
{
  "status": "degraded",
  "services": {
    "aiModels": {
      "circuitBreakerOpen": true,
      "failures": 3,
      "lastFailureTime": "2025-11-06T10:30:00.000Z",
      "status": "circuit-open"
    }
  }
}
```

### Check Circuit Breaker Status

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3011/ai-circuit-breaker/status
```

**Response:**
```json
{
  "isOpen": true,
  "failures": 3,
  "maxFailures": 3,
  "resetTimeout": 60000,
  "lastFailureTime": "2025-11-06T10:30:00.000Z",
  "timeUntilReset": 45000,
  "status": "OPEN - Using fallback mechanisms"
}
```

### Manually Reset Circuit Breaker

If you've fixed the AI issue (e.g., updated API key), you can manually reset:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3011/ai-circuit-breaker/reset
```

**Response:**
```json
{
  "success": true,
  "message": "AI circuit breaker reset. AI models re-enabled.",
  "previousState": {
    "isOpen": true,
    "failures": 3
  },
  "currentState": {
    "isOpen": false,
    "failures": 0
  }
}
```

## Log Messages

### Circuit Breaker Logs

```
[AI CIRCUIT BREAKER] ⚠️ Circuit opened after 3 failures. AI models disabled for 60s
[AI CIRCUIT BREAKER] 🔄 Circuit reset, AI models re-enabled
[AI CIRCUIT BREAKER] ✅ AI call successful, resetting failure count from 1
```

### Fallback Activation Logs

```
[AI BYPASS] Circuit breaker open, using fallback classification for: "יין אדום"
[AI FALLBACK] Using rule-based classification for: "red wine"
[FALLBACK CLASSIFICATION] Query: "יין ברקן" -> SIMPLE (2 words)
[FALLBACK FILTER EXTRACTION] Extracted filters: { "minPrice": 50, "maxPrice": 200 }
```

### LLM Reordering Skip

```
[xyz123] Skipping LLM reordering (AI circuit breaker open)
```

## Impact on Search Quality

### When AI is Available (Normal Mode)
- ✅ Best accuracy for query classification
- ✅ Complete filter extraction (all filter types)
- ✅ Intelligent result reordering for complex queries
- ✅ Context-aware synonym handling

### When Using Fallbacks (Circuit Open)
- ⚠️ Good accuracy for query classification (rule-based heuristics)
- ⚠️ Limited filter extraction (prices only, no categories/types)
- ⚠️ No LLM reordering (relies on RRF scores + sorting logic)
- ⚠️ No synonym handling or intelligent mapping
- ✅ Search still works and returns relevant results
- ✅ Text matching and vector search unaffected
- ✅ Performance may be slightly faster (no AI calls)

## Configuration

You can adjust circuit breaker settings in `server.js`:

```javascript
const aiCircuitBreaker = {
  failures: 0,
  maxFailures: 3,        // Open circuit after N failures
  resetTimeout: 60000,   // Reset after N milliseconds (60s)
  lastFailureTime: null,
  isOpen: false
};
```

## Best Practices

1. **Monitor the `/health` endpoint** regularly to detect circuit opens
2. **Set up alerts** when `aiModels.status` becomes `"circuit-open"`
3. **Check logs** for repeated `[AI FALLBACK]` or `[AI BYPASS]` messages
4. **Fix the root cause** (API key, rate limits, billing) rather than just resetting
5. **Test fallbacks** by temporarily disabling AI to ensure degraded mode works

## Troubleshooting

### Circuit Keeps Opening

**Possible causes:**
- Invalid or expired Gemini API key
- Rate limit exceeded (check your Gemini quotas)
- Network connectivity issues
- Gemini service outage

**Solutions:**
1. Check your `GEMINI_API_KEY` environment variable
2. Verify API key is valid at https://aistudio.google.com/apikey
3. Check Gemini quotas and billing status
4. Review error logs for specific error messages
5. Consider increasing `maxFailures` or `resetTimeout` if transient issues

### Search Quality Degraded

If search quality is poor while circuit is open:

1. **Verify the issue is fixed** (check Gemini console, API key, etc.)
2. **Manually reset the circuit breaker** using the `/ai-circuit-breaker/reset` endpoint
3. **Monitor logs** to confirm AI calls are succeeding
4. If problems persist, check if the issue is with fallback logic rather than AI

### False Positives (Circuit Opens Unnecessarily)

If the circuit opens too easily:

1. **Increase `maxFailures`** from 3 to 5 or more
2. **Increase `resetTimeout`** if failures are transient
3. **Check for timeout issues** - might need to increase AI call timeouts

## Security Note

The circuit breaker control endpoints (`/ai-circuit-breaker/*`) require authentication. Only authorized users can check status or reset the circuit breaker.

## Summary

✅ **Automatic failover** to rule-based alternatives
✅ **Self-healing** with automatic circuit reset
✅ **Graceful degradation** - search continues working
✅ **Manual control** via API endpoints
✅ **Detailed logging** for monitoring and debugging
✅ **Zero downtime** - no user-facing errors

Your search API is now resilient to AI model failures! 🎉

