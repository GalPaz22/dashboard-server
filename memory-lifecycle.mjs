// Expire idle entries as well as entries accessed by callers. The timer does not
// keep the server alive; dispose() is available for tests and explicit shutdown.
export class ExpiringMap extends Map {
  constructor({ maxEntries = 500, ttlMs = 300000, expiresAt = value => value.expiresAt, now = Date.now, sweepMs = 60000 } = {}) {
    super();
    Object.assign(this, { maxEntries, ttlMs, expiresAt, now });
    this.deadlines = new Map();
    this.timer = setInterval(() => this.sweep(), sweepMs);
    this.timer.unref();
  }
  set(key, value) {
    this.sweep();
    if (!this.has(key) && this.size >= this.maxEntries) this.delete(this.keys().next().value);
    super.set(key, value);
    this.deadlines.set(key, this.expiresAt(value) ?? this.now() + this.ttlMs);
    return this;
  }
  get(key) {
    if (this.deadlines.get(key) <= this.now()) this.delete(key);
    return super.get(key);
  }
  delete(key) { this.deadlines.delete(key); return super.delete(key); }
  clear() { this.deadlines.clear(); super.clear(); }
  sweep() { for (const [key, deadline] of this.deadlines) if (deadline <= this.now()) this.delete(key); }
  dispose() { clearInterval(this.timer); this.clear(); }
}

export async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
