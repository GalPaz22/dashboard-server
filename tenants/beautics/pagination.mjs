import { storefrontResponse } from './response.mjs';

// Adapt existing storefront pagination to the same v2 search session.
export function createBeauticsLoadMore(search) {
  return async (req, res, next) => {
    const { token, limit = 20 } = req.query;
    if (typeof token !== 'string' || !token.startsWith('beautics-v2:')) return next();
    if (req.store?.dbName !== 'woo-beautics-shop-co-il') {
      return res.status(400).json({error:'Invalid pagination token'});
    }
    const pageSize = Number(limit);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      return res.status(400).json({error:'Invalid limit'});
    }
    const cursor = token.slice('beautics-v2:'.length);
    if (!cursor) return res.status(400).json({error:'Invalid pagination token'});
    try {
      const result = await search({cursor, limit:pageSize});
      return res.json(storefrontResponse(result, true));
    } catch (error) {
      if (error.message === 'Invalid cursor' || error.message === 'Search expired; start a new search') {
        return res.status(410).json({error:'Search expired; start a new search'});
      }
      return res.status(503).json({error:'Search temporarily unavailable',retryable:true});
    }
  };
}
