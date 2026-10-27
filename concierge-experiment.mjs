/* =========================================================================== *\
   CONCIERGE A/B TEST — who sees the storefront concierge, and what it did
   ---------------------------------------------------------------------------
   Exposure is controlled from the store's users doc, not from the plugin:

     conciergeExperiment: { id: "cx-2026-10", mode: "test", percent: 50 }

     mode "off"  → nobody gets the concierge component
     mode "all"  → everybody does (the default when the field is missing,
                   so stores that never set it keep today's behaviour)
     mode "test" → `percent` of sessions get it ("treatment"), the rest
                   don't ("control")

   Assignment hashes experiment id + session id, so a browser keeps its arm
   across visits, and a new id reshuffles everyone. The store config is cached
   for 5 minutes, so a change lands within that.

   Collections (store database):
     concierge_ab_sessions  one row per experiment + session: arm, first/last seen
     concierge_ab_events    what treatment sessions did with the component
   Outcomes for both arms come from data already collected per session:
   product_clicks, cart, checkout_events.
\* =========================================================================== */

const MODES = new Set(["off", "all", "test"]);
const ARMS = new Set(["treatment", "control"]);
const EVENT_TYPES = new Set([
  "nudge_shown", "nudge_submitted", "nudge_dismissed",
  "panel_opened", "panel_closed", "message_sent", "product_clicked",
  "prompt_bar_submitted",
]);
const MAX_EVENTS_PER_BATCH = 20;

function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** The experiment as configured on the store, normalized. */
export function experimentConfig(store) {
  const raw = store?.conciergeExperiment;
  if (!raw || typeof raw !== "object") return { id: null, mode: "all", percent: 100 };
  const mode = MODES.has(raw.mode) ? raw.mode : "all";
  const percent = Math.max(0, Math.min(100, Number(raw.percent)));
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 60) : null,
    mode,
    percent: Number.isFinite(percent) ? percent : 50,
  };
}

/**
 * This session's arm. `show` is the only thing the storefront and the search
 * trigger need; `arm` is what gets recorded (null when nothing is tested).
 */
export function assignConcierge(store, sessionId) {
  const exp = experimentConfig(store);
  if (exp.mode === "off") return { experiment_id: exp.id, arm: null, show: false };
  if (exp.mode === "all" || !exp.id) return { experiment_id: exp.id, arm: null, show: exp.mode !== "off" };
  // Without a session there is nothing to keep the arm stable on: no component.
  if (!sessionId) return { experiment_id: exp.id, arm: "control", show: false };
  const bucket = fnv1a32(`${exp.id}:${sessionId}`) % 10000;
  const arm = bucket < Math.round(exp.percent * 100) ? "treatment" : "control";
  return { experiment_id: exp.id, arm, show: arm === "treatment" };
}

const indexed = new Set();
function ensureIndexes(db, dbName) {
  if (indexed.has(dbName)) return;
  indexed.add(dbName);
  db.collection("concierge_ab_sessions").createIndex({ experiment_id: 1, session_id: 1 }, { unique: true }).catch(() => {});
  db.collection("concierge_ab_events").createIndex({ experiment_id: 1, type: 1, timestamp: -1 }).catch(() => {});
}

function cleanId(v, max = 80) {
  return typeof v === "string" && /^[\w.:-]+$/.test(v) ? v.slice(0, max) : null;
}

/**
 * Report: for each arm, how many sessions searched, and how many of them
 * clicked a product, added to cart and ordered (with revenue) after they were
 * first assigned. Plus the treatment's engagement with the component.
 */
export async function experimentReport(db, experimentId, { from = null, to = null } = {}) {
  const seen = {};
  if (from) seen.$gte = new Date(from);
  if (to) seen.$lte = new Date(to);
  const sessions = await db.collection("concierge_ab_sessions")
    .find({ experiment_id: experimentId, ...(from || to ? { first_seen: seen } : {}) })
    .project({ session_id: 1, arm: 1, first_seen: 1 }).toArray();

  const firstSeen = new Map(sessions.map((s) => [s.session_id, s.first_seen]));
  const armOf = new Map(sessions.map((s) => [s.session_id, s.arm]));
  const ids = [...armOf.keys()];
  const after = (doc, field) => {
    const at = doc[field] ? new Date(doc[field]) : null;
    const start = firstSeen.get(doc.session_id);
    return !at || !start || at >= new Date(start);
  };

  const inIds = { session_id: { $in: ids } };
  const [clicks, carts, orders, events] = ids.length ? await Promise.all([
    db.collection("product_clicks").find(inIds).project({ session_id: 1, timestamp: 1 }).toArray(),
    db.collection("cart").find(inIds).project({ session_id: 1, created_at: 1 }).toArray(),
    db.collection("checkout_events").find(inIds).project({ session_id: 1, total_price: 1, created_at: 1, timestamp: 1 }).toArray(),
    db.collection("concierge_ab_events").find({ experiment_id: experimentId, ...inIds }).project({ session_id: 1, type: 1, reason: 1 }).toArray(),
  ]) : [[], [], [], []];

  const arms = {};
  for (const arm of ARMS) arms[arm] = { sessions: 0, clicked: 0, added_to_cart: 0, ordered: 0, orders: 0, revenue: 0 };
  for (const arm of armOf.values()) if (arms[arm]) arms[arm].sessions++;

  const countSessions = (docs, field, key) => {
    const done = new Set();
    for (const d of docs) {
      if (done.has(d.session_id) || !after(d, field)) continue;
      done.add(d.session_id);
      const a = arms[armOf.get(d.session_id)];
      if (a) a[key]++;
    }
  };
  countSessions(clicks, "timestamp", "clicked");
  countSessions(carts, "created_at", "added_to_cart");
  countSessions(orders, "created_at", "ordered");
  for (const o of orders) {
    if (!after(o, "created_at")) continue;
    const a = arms[armOf.get(o.session_id)];
    if (a) { a.orders++; a.revenue += Number(o.total_price) || 0; }
  }
  for (const a of Object.values(arms)) {
    const rate = (n) => (a.sessions ? Number((n / a.sessions).toFixed(4)) : null);
    a.click_rate = rate(a.clicked);
    a.cart_rate = rate(a.added_to_cart);
    a.order_rate = rate(a.ordered);
    a.revenue = Number(a.revenue.toFixed(2));
    a.revenue_per_session = a.sessions ? Number((a.revenue / a.sessions).toFixed(2)) : null;
  }

  const engagement = {};
  const engagedSessions = new Set();
  for (const e of events) {
    const key = e.type === "panel_opened" && e.reason ? `panel_opened:${e.reason}` : e.type;
    engagement[key] = engagement[key] || { events: 0, sessions: new Set() };
    engagement[key].events++;
    engagement[key].sessions.add(e.session_id);
    if (["nudge_submitted", "message_sent", "product_clicked", "prompt_bar_submitted"].includes(e.type)) engagedSessions.add(e.session_id);
  }
  const engagementOut = Object.fromEntries(Object.entries(engagement).map(([k, v]) => [k, { events: v.events, sessions: v.sessions.size }]));

  return {
    experiment_id: experimentId,
    arms,
    engagement: {
      ...engagementOut,
      engaged_sessions: engagedSessions.size,
      engaged_rate: arms.treatment.sessions ? Number((engagedSessions.size / arms.treatment.sessions).toFixed(4)) : null,
    },
  };
}

/**
 * GET  /concierge/assignment?session_id=   → { show, arm, experiment_id }
 * POST /concierge/events  { session_id, experiment_id, events: [{ type, reason?, query?, product_id? }] }
 * GET  /concierge/experiment-report?experiment_id=&from=&to=   (X-Semantix-Admin token)
 *
 * All behind the API-key middleware like every other route, so req.store is
 * the key's store. The report also needs the admin token: the API key is
 * public in the storefront's page source.
 */
export function mountConciergeExperiment(app, { getMongoClient, adminToken = () => process.env.SEMANTIX_ADMIN_TOKEN }) {
  app.get("/concierge/assignment", async (req, res) => {
    if (!req.store) return res.status(401).json({ error: "Invalid or missing API key" });
    res.set("Cache-Control", "no-store");
    const sessionId = cleanId(req.query.session_id);
    const result = req.store.conciergeEnabled === true
      ? assignConcierge(req.store, sessionId)
      : { experiment_id: null, arm: null, show: false };
    if (result.arm && sessionId) {
      try {
        const db = (await getMongoClient()).db(req.store.dbName);
        ensureIndexes(db, req.store.dbName);
        const now = new Date();
        db.collection("concierge_ab_sessions").updateOne(
          { experiment_id: result.experiment_id, session_id: sessionId },
          { $setOnInsert: { experiment_id: result.experiment_id, session_id: sessionId, arm: result.arm, first_seen: now }, $set: { last_seen: now }, $inc: { exposures: 1 } },
          { upsert: true },
        ).catch((err) => { if (err?.code !== 11000) console.warn("[CONCIERGE AB] exposure log failed:", err.message); });
      } catch (err) {
        console.warn("[CONCIERGE AB] exposure log failed:", err.message);
      }
    }
    return res.json(result);
  });

  app.post("/concierge/events", async (req, res) => {
    if (!req.store) return res.status(401).json({ error: "Invalid or missing API key" });
    const sessionId = cleanId(req.body?.session_id);
    const experimentId = typeof req.body?.experiment_id === "string" ? req.body.experiment_id.slice(0, 60) : null;
    const list = Array.isArray(req.body?.events) ? req.body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];
    if (!sessionId || !experimentId || !list.length) return res.status(400).json({ error: "session_id, experiment_id and events are required" });
    // Only sessions the server itself put in this experiment's treatment arm.
    const assigned = assignConcierge(req.store, sessionId);
    if (assigned.experiment_id !== experimentId || assigned.arm !== "treatment") return res.status(202).json({ accepted: 0 });
    const now = new Date();
    const docs = list.filter((e) => e && EVENT_TYPES.has(e.type)).map((e) => ({
      experiment_id: experimentId,
      session_id: sessionId,
      type: e.type,
      reason: cleanId(e.reason, 40),
      query: typeof e.query === "string" ? e.query.slice(0, 200) : null,
      product_id: e.product_id == null ? null : String(e.product_id).slice(0, 60),
      timestamp: now,
    }));
    if (!docs.length) return res.status(202).json({ accepted: 0 });
    try {
      const db = (await getMongoClient()).db(req.store.dbName);
      ensureIndexes(db, req.store.dbName);
      await db.collection("concierge_ab_events").insertMany(docs, { ordered: false });
      return res.status(202).json({ accepted: docs.length });
    } catch (err) {
      console.warn("[CONCIERGE AB] event log failed:", err.message);
      return res.status(500).json({ error: "event_log_failed" });
    }
  });

  app.get("/concierge/experiment-report", async (req, res) => {
    const token = adminToken();
    if (!token || req.get("X-Semantix-Admin") !== token) return res.status(404).end();
    if (!req.store) return res.status(401).json({ error: "Invalid or missing API key" });
    const experimentId = typeof req.query.experiment_id === "string" && req.query.experiment_id
      ? req.query.experiment_id : experimentConfig(req.store).id;
    if (!experimentId) return res.status(400).json({ error: "experiment_id is required" });
    try {
      const db = (await getMongoClient()).db(req.store.dbName);
      const report = await experimentReport(db, experimentId, { from: req.query.from || null, to: req.query.to || null });
      return res.set("Cache-Control", "no-store").json({ ...report, config: experimentConfig(req.store) });
    } catch (err) {
      console.error("[CONCIERGE AB] report failed:", err);
      return res.status(500).json({ error: "report_failed" });
    }
  });
}
