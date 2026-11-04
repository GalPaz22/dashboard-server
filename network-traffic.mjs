import { Buffer } from 'node:buffer';

// Measure application payloads, not TCP/TLS overhead. Never retain payloads or keys.
export function payloadBytes(value) {
  if (value == null) return 0;
  if (Buffer.isBuffer(value)) return value.length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + payloadBytes(item), 0);
  return Buffer.byteLength(String(value));
}

// Count JSON bytes without allocating another copy of a large base64 request.
export function jsonBytes(value) {
  if (value === null) return 4;
  if (typeof value === 'string') {
    let bytes = Buffer.byteLength(value) + 2;
    for (const match of value.matchAll(/["\\\u0000-\u001f]/g)) {
      bytes += /["\\\b\f\n\r\t]/.test(match[0]) ? 1 : 5;
    }
    bytes += (value.match(/[\uD800-\uDFFF]/gu)?.length || 0) * 3;
    return bytes;
  }
  if (Array.isArray(value)) {
    let bytes = 2 + Math.max(0, value.length - 1);
    for (const item of value) bytes += jsonBytes(item) ?? 4;
    return bytes;
  }
  if (typeof value === 'object') {
    if (typeof value.toJSON === 'function') return jsonBytes(value.toJSON());
    let bytes = 2, count = 0;
    for (const [key, item] of Object.entries(value)) {
      const size = jsonBytes(item);
      if (size === undefined) continue;
      bytes += (count++ ? 1 : 0) + jsonBytes(key) + 1 + size;
    }
    return bytes;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? undefined : Buffer.byteLength(encoded);
}

export function createTrafficMonitor({ log = console, now = Date.now } = {}) {
  let startedAt = now();
  const buckets = new Map();
  function start(service, operation, sentBytes) {
    const key = `${service}.${operation}`;
    const bucket = buckets.get(key) || { operations: 0, failures: 0, sentBytes: 0, receivedBytes: 0 };
    buckets.set(key, bucket);
    bucket.operations++;
    bucket.sentBytes += sentBytes;
    return (receivedBytes = 0, failed = false) => {
      // A call can finish in a later reporting window.
      const current = buckets.get(key) || { operations: 0, failures: 0, sentBytes: 0, receivedBytes: 0 };
      buckets.set(key, current);
      current.receivedBytes += receivedBytes;
      if (failed) current.failures++;
    };
  }
  function flush() {
    const endedAt = now();
    if (buckets.size) log.log('[NETWORK]', JSON.stringify({
      windowMs: endedAt - startedAt, measurement: 'application-payload', traffic: Object.fromEntries(buckets)
    }));
    buckets.clear();
    startedAt = endedAt;
  }
  return { start, flush };
}

function redisScope(key) {
  const prefix = String(key).split(':', 1)[0];
  return ['simple-search', 'pagination', 'search-pagination'].includes(prefix) ? prefix : 'other';
}

export function observeRedisTraffic(client, monitor) {
  // These cover cached values, pagination hashes, and atomic pagination updates.
  for (const method of ['get', 'setEx', 'hmGet', 'eval']) {
    const original = client[method].bind(client);
    client[method] = async (...args) => {
      const key = method === 'eval' ? args[1]?.keys?.[0] : args[0];
      const values = method === 'eval' ? [args[0], args[1]?.keys || [], args[1]?.arguments || []] : args;
      const finish = monitor.start('redis', `${method}.${redisScope(key)}`, payloadBytes(values));
      try {
        const result = await original(...args);
        finish(payloadBytes(result));
        return result;
      } catch (error) {
        finish(0, true);
        throw error;
      }
    };
  }
  return client;
}

export function observeGeminiTraffic(models, monitor) {
  const original = models.generateContent.bind(models);
  models.generateContent = async request => {
    const contents = Array.isArray(request.contents) ? request.contents : [request.contents];
    const hasImages = contents.some(content => content?.inlineData || content?.parts?.some(part => part.inlineData));
    const finish = monitor.start('gemini', hasImages ? 'image' : 'text', jsonBytes(request));
    try {
      const response = await original(request);
      finish(payloadBytes(response.text));
      return response;
    } catch (error) {
      finish(0, true);
      throw error;
    }
  };
}
