// Immutable vectors and mutable pagination state share one hash and one expiry.
// Versioned keys allow sessions issued before deployment to keep working.
const STORE = `
if ARGV[4] == '1' and redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'state', ARGV[1], 'embeddings', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1`;

const UPDATE = `
local raw = redis.call('HGET', KEYS[1], 'state')
if not raw then return false end
local state = cjson.decode(raw)
local ids = cjson.decode(ARGV[1])
local delivered = state.deliveredIds or {}
for _, id in ipairs(ids) do table.insert(delivered, id) end
state.deliveredIds = delivered
state.batchNumber = tonumber(ARGV[2])
state.lastUpdate = tonumber(ARGV[3])
local updated = cjson.encode(state)
if #delivered == 0 then
  state.deliveredIds = nil
  updated = string.sub(cjson.encode(state), 1, -2) .. ',"deliveredIds":[]}'
end
redis.call('HSET', KEYS[1], 'state', updated)
redis.call('EXPIRE', KEYS[1], ARGV[4])
return updated`;

const keyFor = sessionId => `pagination:v2:${sessionId}`;

export async function savePaginationState(redis, sessionId, data, ttl, onlyIfAbsent = false) {
  const { topProductEmbeddings, ...state } = data;
  await redis.eval(STORE, {
    keys: [keyFor(sessionId)],
    arguments: [JSON.stringify(state), JSON.stringify(topProductEmbeddings || []), String(ttl), onlyIfAbsent ? '1' : '0']
  });
}

export async function readPaginationState(redis, sessionId) {
  const [state, embeddings] = await redis.hmGet(keyFor(sessionId), ['state', 'embeddings']);
  if (state) return { ...JSON.parse(state), topProductEmbeddings: JSON.parse(embeddings || '[]') };
  const legacy = await redis.get(`pagination:${sessionId}`);
  return legacy ? JSON.parse(legacy) : null;
}

export async function appendPaginationIds(redis, sessionId, ids, batchNumber, ttl) {
  const update = () => redis.eval(UPDATE, {
    keys: [keyFor(sessionId)],
    arguments: [JSON.stringify(ids), String(batchNumber), String(Date.now()), String(ttl)]
  });
  let result = await update();
  if (!result) {
    // One-time migration of sessions issued by the previous server version.
    const legacy = await redis.get(`pagination:${sessionId}`);
    if (!legacy) return null;
    await savePaginationState(redis, sessionId, JSON.parse(legacy), ttl, true);
    result = await update();
  }
  return result ? JSON.parse(result) : null;
}
