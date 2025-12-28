/**
 * Add to Cart Tracking Script
 *
 * Include this script on your e-commerce site to track add-to-cart events.
 *
 * CONFIGURATION:
 * - Replace API_KEY with your API key
 * - Replace API_ENDPOINT with your server endpoint
 */

(function() {
  // ============ CONFIGURATION ============
  const CONFIG = {
    API_ENDPOINT: 'https://your-server.com/search-to-cart',  // Replace with your actual endpoint
    API_KEY: 'your-api-key-here'  // Replace with your API key
  };

  // Session storage keys
  const STORAGE_KEYS = {
    SESSION_ID: 'search_session_id',
    LAST_SEARCH_QUERY: 'last_search_query',
    SEARCH_RESULTS: 'search_results',
    TIER2_RESULTS: 'tier2_results'
  };

  // ============ UTILITY FUNCTIONS ============

  /**
   * Generate a unique session ID
   */
  function generateSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Get or create session ID
   */
  function getSessionId() {
    let sessionId = sessionStorage.getItem(STORAGE_KEYS.SESSION_ID);
    if (!sessionId) {
      sessionId = generateSessionId();
      sessionStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
    }
    return sessionId;
  }

  /**
   * Store search context (call this after each search)
   */
  window.storeSearchContext = function(query, searchResults, tier2Results = []) {
    sessionStorage.setItem(STORAGE_KEYS.LAST_SEARCH_QUERY, query);
    sessionStorage.setItem(STORAGE_KEYS.SEARCH_RESULTS, JSON.stringify(searchResults));
    if (tier2Results.length > 0) {
      sessionStorage.setItem(STORAGE_KEYS.TIER2_RESULTS, JSON.stringify(tier2Results));
    }
  };

  /**
   * Get stored search context
   */
  function getSearchContext() {
    return {
      query: sessionStorage.getItem(STORAGE_KEYS.LAST_SEARCH_QUERY) || '',
      searchResults: JSON.parse(sessionStorage.getItem(STORAGE_KEYS.SEARCH_RESULTS) || '[]'),
      tier2Results: JSON.parse(sessionStorage.getItem(STORAGE_KEYS.TIER2_RESULTS) || '[]')
    };
  }

  // ============ TRACKING FUNCTIONS ============

  /**
   * Track add-to-cart event
   *
   * @param {string|number} productId - The product ID being added to cart
   * @param {object} additionalData - Optional additional data (quantity, variant, etc.)
   */
  window.trackAddToCart = async function(productId, additionalData = {}) {
    const searchContext = getSearchContext();
    const sessionId = getSessionId();

    const payload = {
      document: {
        event_type: 'add_to_cart',
        product_id: String(productId),
        search_query: searchContext.query,
        search_results: searchContext.searchResults,
        tier2_results: searchContext.tier2Results,
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        ...additionalData
      }
    };

    try {
      const response = await fetch(CONFIG.API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CONFIG.API_KEY
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      console.log('[Add to Cart Tracking] Event tracked:', result);
      return result;
    } catch (error) {
      console.error('[Add to Cart Tracking] Error:', error);
      return null;
    }
  };

  /**
   * Track checkout initiated event
   *
   * @param {object} checkoutData - Checkout details (cart_total, cart_count, etc.)
   */
  window.trackCheckoutInitiated = async function(checkoutData = {}) {
    const searchContext = getSearchContext();
    const sessionId = getSessionId();

    const payload = {
      document: {
        event_type: 'checkout_initiated',
        search_query: searchContext.query,
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        cart_total: checkoutData.cart_total || null,
        cart_count: checkoutData.cart_count || null,
        ...checkoutData
      }
    };

    try {
      const response = await fetch(CONFIG.API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CONFIG.API_KEY
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      console.log('[Checkout Tracking] Checkout initiated tracked:', result);
      return result;
    } catch (error) {
      console.error('[Checkout Tracking] Error:', error);
      return null;
    }
  };

  /**
   * Track checkout completed event
   *
   * @param {object} orderData - Order details (order_id, order_total, etc.)
   */
  window.trackCheckoutCompleted = async function(orderData = {}) {
    const searchContext = getSearchContext();
    const sessionId = getSessionId();

    const payload = {
      document: {
        event_type: 'checkout_completed',
        search_query: searchContext.query,
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        order_id: orderData.order_id || null,
        order_total: orderData.order_total || null,
        ...orderData
      }
    };

    try {
      const response = await fetch(CONFIG.API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CONFIG.API_KEY
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      console.log('[Checkout Tracking] Checkout completed tracked:', result);
      return result;
    } catch (error) {
      console.error('[Checkout Tracking] Error:', error);
      return null;
    }
  };

  /**
   * Track product click event
   *
   * @param {string|number} productId - The product ID being clicked
   * @param {string} productName - Optional product name
   */
  window.trackProductClick = async function(productId, productName = null) {
    const searchContext = getSearchContext();
    const sessionId = getSessionId();

    const payload = {
      product_id: String(productId),
      product_name: productName,
      search_query: searchContext.query,
      session_id: sessionId
    };

    try {
      const response = await fetch(CONFIG.API_ENDPOINT.replace('/search-to-cart', '/product-click'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CONFIG.API_KEY
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      console.log('[Product Click Tracking] Click tracked:', result);
      return result;
    } catch (error) {
      console.error('[Product Click Tracking] Error:', error);
      return null;
    }
  };

  /**
   * Get all product clicks for current session
   */
  window.getSessionClicks = async function() {
    const sessionId = getSessionId();

    try {
      const response = await fetch(
        CONFIG.API_ENDPOINT.replace('/search-to-cart', `/product-clicks/${sessionId}`),
        {
          method: 'GET',
          headers: {
            'X-API-Key': CONFIG.API_KEY
          }
        }
      );

      const result = await response.json();
      console.log('[Product Click Tracking] Session clicks:', result);
      return result;
    } catch (error) {
      console.error('[Product Click Tracking] Error fetching clicks:', error);
      return null;
    }
  };

  console.log('[Add to Cart Tracking] Script loaded. Session ID:', getSessionId());
})();


/* ============ USAGE EXAMPLES ============

// 1. After performing a search, store the context:
storeSearchContext('red wine dry', ['Wine A', 'Wine B', 'Wine C'], ['Wine D', 'Wine E']);

// 2. When user clicks on a product (product detail page):
trackProductClick('12345', 'Wine Product Name');

// 3. When user clicks "Add to Cart":
trackAddToCart('12345', { quantity: 2, variant: 'bottle' });

// 4. When user initiates checkout:
trackCheckoutInitiated({ cart_total: 150.00, cart_count: 3 });

// 5. When checkout is completed:
trackCheckoutCompleted({ order_id: 'ORD-123', order_total: 150.00 });

// 6. Get all clicks for current session:
getSessionClicks().then(data => console.log(data));

*/
