// A/B experiment + permanent-rule hook for the search-optimizer control plane.
// Reads active experiment/rule definitions published by search-optimizer to
// Redis, applies them to the store config for this request, and returns a
// patched copy. Any failure anywhere returns the original store — the search
// path must never depend on this.
//
// The assignment/condition math (fnv1a32 / bucket / cumulative weights /
// time windows) MUST stay behaviorally identical to
// search-optimizer/src/core/assignment.ts.

const inProcessCache = new Map(); // "experiments"|"rules" + apiKey -> { at, data }
const IN_PROCESS_TTL_MS = 15_000;

function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function assignArm(exp, sessionId) {
  if (!sessionId) return null;
  const bucket = fnv1a32(`${exp.id}:${sessionId}`) % 10000;
  const enrolledRange = Math.floor(exp.trafficPct * 100);
  if (bucket >= enrolledRange) return null;
  const totalWeight = exp.arms.reduce((s, a) => s + a.weight, 0);
  if (totalWeight <= 0) return null;
  let cum = 0;
  for (const arm of exp.arms) {
    cum += (arm.weight / totalWeight) * enrolledRange;
    if (bucket < cum) return arm.key;
  }
  return exp.arms[exp.arms.length - 1].key;
}

/** Current hour (0-23) in the given IANA timezone. */
function currentHourInTimezone(timezone, now = new Date()) {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: timezone,
  }).format(now);
  return parseInt(hourStr, 10) % 24;
}

function timeWindowMatches(tw, now = new Date()) {
  const hour = currentHourInTimezone(tw.timezone, now);
  if (tw.startHour === tw.endHour) return true; // 24h window
  if (tw.startHour < tw.endHour) return hour >= tw.startHour && hour < tw.endHour;
  return hour >= tw.startHour || hour < tw.endHour; // wraps past midnight, e.g. 22 -> 6
}

/** A condition (targeting) matches when its query AND time-window parts (if present) both hold. */
function queryMatchesTargeting(targeting, query, now = new Date()) {
  if (!targeting) return true;
  if (targeting.mode === "queryMatch") {
    const q = (query || "").trim().toLowerCase();
    if (!q) return false;
    const patterns = targeting.patterns || [];
    const matched = patterns.some((p) => {
      const pat = String(p).trim().toLowerCase();
      return targeting.matchType === "exact" ? q === pat : q.includes(pat);
    });
    if (!matched) return false;
  }
  if (targeting.timeWindow && !timeWindowMatches(targeting.timeWindow, now)) return false;
  return true;
}

async function getCached(kind, redisClient, apiKey, redisKeyPrefix) {
  const cacheKey = `${kind}:${apiKey}`;
  const cached = inProcessCache.get(cacheKey);
  if (cached && Date.now() - cached.at < IN_PROCESS_TTL_MS) return cached.data;
  let data = [];
  try {
    if (redisClient?.isOpen) {
      const raw = await redisClient.get(`${redisKeyPrefix}:${apiKey}`);
      if (raw) data = JSON.parse(raw);
    }
  } catch {
    data = [];
  }
  inProcessCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

const getActiveExperiments = (redisClient, apiKey) => getCached("experiments", redisClient, apiKey, "experiments:active");
const getActiveRules = (redisClient, apiKey) => getCached("rules", redisClient, apiKey, "rules:active");

/**
 * Rule-based cross-category association ("show cognac on 'brandy'"). Resolves
 * the association to a handful of product _ids from the tenant's own products
 * collection and returns them as a synthetic pinned-results rule keyed to the
 * verbatim query text — the existing getPinnedProductsForQuery/mergePinnedProducts
 * machinery (already wired into every search handler) then re-fetches and
 * prepends them exactly like a merchant-authored pin. Never throws.
 */
async function resolveCategoryAssociation(assoc, query, tenantDb) {
  try {
    if (!tenantDb || !query) return null;
    const orClauses = [];
    if (assoc.softCategories?.length) orClauses.push({ softCategory: { $in: assoc.softCategories } });
    if (assoc.categories?.length) orClauses.push({ category: { $in: assoc.categories } });
    if (orClauses.length === 0) return null;

    const docs = await tenantDb
      .collection("products")
      .find({ $or: orClauses, hidden: { $ne: true } })
      .project({ _id: 1 })
      .sort({ boost: -1 })
      .limit(assoc.limit || 5)
      .maxTimeMS(400)
      .toArray();
    if (docs.length === 0) return null;

    return { query, productIds: docs.map((d) => d._id.toString()), enabled: true };
  } catch (err) {
    console.error("[experiments] categoryAssociation resolution failed:", err?.message);
    return null;
  }
}

/**
 * Merges one patch into a (copy-on-write) store object. Shared by the
 * experiment path and the permanent-rules path so both interpret the same
 * patch shapes identically. Returns the (possibly new) store object.
 */
async function mergePatchIntoStore(store, patch, query, tenantDb) {
  if (!patch || Object.keys(patch).length === 0) return store;
  const patched = { ...store };

  if (patch.softCategoriesBoost) {
    patched.softCategoriesBoost = { ...(patched.softCategoriesBoost || {}), ...patch.softCategoriesBoost };
  }
  if (patch.pinnedResults) {
    const existingPins = patched.pinnedResults || [];
    const newQueries = new Set(patch.pinnedResults.map((r) => (r.query || "").toLowerCase()));
    patched.pinnedResults = [
      ...patch.pinnedResults,
      ...existingPins.filter((r) => !newQueries.has((r.query || "").toLowerCase())),
    ];
  }
  if (patch.productBoosts) {
    patched.experimentBoosts = { ...(patched.experimentBoosts || {}), ...patch.productBoosts };
  }
  if (typeof patch.profileBoostMultiplier === "number") {
    patched.profileBoostMultiplier = (patched.profileBoostMultiplier ?? 1) * patch.profileBoostMultiplier;
  }
  if (patch.categoryAssociation) {
    const rule = await resolveCategoryAssociation(patch.categoryAssociation, query, tenantDb);
    if (rule) {
      const existingPins = patched.pinnedResults || [];
      patched.pinnedResults = [
        rule,
        ...existingPins.filter((r) => (r.query || "").toLowerCase() !== query.toLowerCase()),
      ];
    }
  }
  return patched;
}

function logExposure(tenantDb, experimentId, arm, sessionId, query) {
  setImmediate(() => {
    tenantDb
      .collection("experiment_exposures")
      .insertOne({ experiment_id: experimentId, arm, session_id: sessionId, query, timestamp: new Date() })
      .catch((err) => {
        if (err?.code !== 11000) console.error("[experiments] exposure log failed:", err?.message);
      });
  });
}

/** Fire-and-forget daily trigger counter for a permanent rule, for ops-UI visibility. */
function logRuleTrigger(tenantDb, ruleId) {
  setImmediate(() => {
    const day = new Date().toISOString().slice(0, 10);
    tenantDb
      .collection("rule_applications")
      .updateOne(
        { rule_id: ruleId, date: day },
        { $inc: { count: 1 }, $setOnInsert: { rule_id: ruleId, date: day } },
        { upsert: true }
      )
      .catch((err) => console.error("[rules] trigger log failed:", err?.message));
  });
}

/**
 * Returns the store config to use for this request: either the original
 * object (control / not enrolled / any failure) or a shallow-patched copy.
 * Patched copy may carry `experimentBoosts` {productId: boost} and
 * `profileBoostMultiplier` for downstream scoring hooks.
 */
export async function applyExperimentVariant(store, sessionId, query, tenantDb, redisClient, now = new Date()) {
  try {
    if (!store?.apiKey || !sessionId) return store;
    const experiments = await getActiveExperiments(redisClient, store.apiKey);
    if (!experiments.length) return store;

    let patched = store;
    for (const exp of experiments) {
      if (!queryMatchesTargeting(exp.targeting, query, now)) continue;
      const armKey = assignArm(exp, sessionId);
      if (!armKey) continue;

      if (tenantDb) logExposure(tenantDb, exp.id, armKey, sessionId, query);
      const arm = exp.arms.find((a) => a.key === armKey);
      patched = await mergePatchIntoStore(patched, arm?.patch, query, tenantDb);
    }
    return patched;
  } catch (err) {
    console.error("[experiments] hook failed, serving control:", err?.message);
    return store;
  }
}

/**
 * Permanent, always-on merchandising rules ("boost all red wines 22:00-06:00",
 * "always show whiskey on 'bourbon'"). No control group, no assignment — every
 * request whose query/time condition matches gets the patch. Any failure
 * returns the original store, same as the experiment path.
 */
export async function applyPermanentRules(store, query, tenantDb, redisClient, now = new Date()) {
  try {
    if (!store?.apiKey) return store;
    const rules = await getActiveRules(redisClient, store.apiKey);
    if (!rules.length) return store;

    let patched = store;
    for (const rule of rules) {
      if (!queryMatchesTargeting(rule.condition, query, now)) continue;
      if (tenantDb) logRuleTrigger(tenantDb, rule.id);
      patched = await mergePatchIntoStore(patched, rule.patch, query, tenantDb);
    }
    return patched;
  } catch (err) {
    console.error("[rules] hook failed, serving unmodified store:", err?.message);
    return store;
  }
}

/** 3-line helper for /profile/merge: records old→new session id rewrites. */
export function recordSessionAlias(tenantDb, oldSessionId, newSessionId) {
  if (!tenantDb || !oldSessionId || !newSessionId || oldSessionId === newSessionId) return;
  setImmediate(() => {
    tenantDb
      .collection("session_aliases")
      .updateOne(
        { old_session_id: oldSessionId, new_session_id: newSessionId },
        { $setOnInsert: { old_session_id: oldSessionId, new_session_id: newSessionId, timestamp: new Date() } },
        { upsert: true }
      )
      .catch((err) => console.error("[experiments] session alias failed:", err?.message));
  });
}
