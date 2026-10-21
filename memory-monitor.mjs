import v8 from 'node:v8';

// Heap alarms relative to the heap this process may actually use (V8's limit: --max-old-space-size, or what Node
// derives from the machine/container), not a fixed plan size. Each level logs at most once per interval, so a server
// that runs steadily above a line writes one line a minute instead of two per request. No GC is forced here: a full
// collection on the request path stalls every request in flight, and V8 already collects before it nears its limit.
export const heapLimitMB = () => Math.round(v8.getHeapStatistics().heap_size_limit / 1048576);

export function createMemoryMonitor({limitMB = heapLimitMB(), warningMB, criticalMB, warningRatio = 0.75, criticalRatio = 0.9,
  intervalMs = 60000, usage = () => process.memoryUsage(), now = Date.now, log = console} = {}) {
  const warning = warningMB || Math.round(limitMB * warningRatio), critical = criticalMB || Math.round(limitMB * criticalRatio);
  const last = {warning: -Infinity, critical: -Infinity};
  function check(context = '') {
    const u = usage(), mb = v => Math.round(v / 1048576);
    const heapUsedMB = mb(u.heapUsed), heapTotalMB = mb(u.heapTotal), rssMB = mb(u.rss);
    const level = heapUsedMB >= critical ? 'critical' : heapUsedMB >= warning ? 'warning' : null;
    if (level && now() - last[level] >= intervalMs) {
      last[level] = now();
      const line = `[MEMORY ${level.toUpperCase()}] ${context} - Heap: ${heapUsedMB}MB / Total: ${heapTotalMB}MB / Limit: ${limitMB}MB / RSS: ${rssMB}MB`;
      level === 'critical' ? log.error(line) : log.warn(line);
    }
    return {heapUsedMB, heapTotalMB, rssMB, level};
  }
  return {check, limitMB, warningMB: warning, criticalMB: critical};
}
