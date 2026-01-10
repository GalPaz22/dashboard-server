# Shopify Webhook Integration - Order Tracking

## Overview
This integration allows you to track orders from Shopify and link them to user search sessions, enabling full funnel analytics: **Search → Click → Purchase**.

---

## 🎯 What It Does

1. **Receives Shopify order webhooks** when a customer completes checkout
2. **Extracts session_id** from order metadata to link orders to search tracking
3. **Saves order data** to MongoDB collection `checkout_events`
4. **Matches orders with product clicks** to analyze search-to-purchase conversion

---

## 📋 Setup Instructions

### Step 1: Configure Shopify Webhook

1. Go to **Shopify Admin** → **Settings** → **Notifications** → **Webhooks**
2. Click **Create webhook**
3. Configure:
   - **Event**: `Order creation`
   - **Format**: `JSON`
   - **URL**: `https://api.semantix-ai.com/webhooks/shopify/order-created`
   - **API Version**: Latest stable (e.g., `2024-01`)

4. Click **Save**

### Step 2: Add Session Tracking to Shopify Checkout

To link orders to search sessions, you need to pass the `session_id` to Shopify during checkout.

#### Option A: Using Cart Attributes (Recommended)

Add this to your Shopify theme's cart/checkout JavaScript:

```javascript
// Get tracking session ID (from dew.js)
function getTrackingSessionId() {
  let sessionId = sessionStorage.getItem('tracking_session_id');
  if (!sessionId) {
    sessionId = 'sess-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('tracking_session_id', sessionId);
  }
  return sessionId;
}

// Add session_id to cart attributes before checkout
fetch('/cart/update.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    attributes: {
      session_id: getTrackingSessionId()
    }
  })
});
```

#### Option B: Using Order Note Attributes

If your theme supports custom checkout fields:

```liquid
<!-- In your checkout.liquid or cart template -->
<input type="hidden" name="attributes[session_id]" id="tracking-session-id">

<script>
  document.getElementById('tracking-session-id').value = getTrackingSessionId();
</script>
```

---

## 🔍 Testing Locally with ngrok

Since Shopify can't reach `localhost`, use ngrok for local testing:

### 1. Install ngrok
```bash
brew install ngrok
# or download from https://ngrok.com
```

### 2. Start your local server
```bash
cd /Users/galpaz/Desktop/dashboard-server
npm start
```

### 3. Create ngrok tunnel
```bash
ngrok http 8080
```

You'll get a URL like: `https://abc123.ngrok.io`

### 4. Update Shopify webhook URL
Use: `https://abc123.ngrok.io/webhooks/shopify/order-created`

### 5. Test with a real order
- Make a test purchase in your Shopify store
- Check ngrok terminal for incoming webhook
- Check server logs for processing

---

## 📊 API Endpoints

### 1. Webhook Receiver (Shopify calls this)
```
POST /webhooks/shopify/order-created
```

**Headers** (sent by Shopify):
- `X-Shopify-Hmac-Sha256`: Signature for verification
- `X-Shopify-Shop-Domain`: Your shop domain

**Payload**: Full Shopify order object (JSON)

**Response**:
```json
{
  "status": "success",
  "order_id": "5234567890",
  "session_id": "sess-1234-abc",
  "saved_to": "wineRoute",
  "matched_clicks": true
}
```

---

### 2. Get Checkout Events (Analytics)
```
GET /checkout-events
```

**Headers**:
- `X-API-Key`: Your Semantix API key

**Query Parameters**:
- `session_id` (optional): Get checkouts for specific session
- `days` (optional): Get checkouts from last N days (default: 30)
- `limit` (optional): Max results (default: 100)

**Example Request**:
```bash
curl -X GET "https://api.semantix-ai.com/checkout-events?days=7&limit=50" \
  -H "X-API-Key: your-api-key"
```

**Response**:
```json
{
  "count": 12,
  "total_revenue": "4567.80",
  "avg_order_value": "380.65",
  "currency": "ILS",
  "checkouts": [
    {
      "order_id": "5234567890",
      "order_number": "#1234",
      "session_id": "sess-1234-abc",
      "created_at": "2026-01-10T12:34:56Z",
      "total_price": 450.00,
      "items_count": 3,
      "customer": {
        "email": "customer@example.com",
        "name": "John Doe"
      },
      "matched_clicks": [
        {
          "product_id": "12345",
          "product_name": "Product Name",
          "clicked_at": "2026-01-10T12:30:00Z"
        }
      ],
      "click_count": 5
    }
  ]
}
```

---

## 🗄️ MongoDB Collection Structure

### Collection: `checkout_events`

```javascript
{
  _id: ObjectId("..."),
  order_id: "5234567890",           // Shopify order ID
  order_number: "#1234",             // Human-readable order number
  session_id: "sess-1234-abc",       // Tracking session ID
  created_at: "2026-01-10T12:34:56Z",
  total_price: 450.00,
  subtotal_price: 420.00,
  total_tax: 30.00,
  currency: "ILS",
  
  customer: {
    id: "123456",
    email: "customer@example.com",
    first_name: "John",
    last_name: "Doe",
    phone: "+972501234567"
  },
  
  line_items: [
    {
      product_id: "12345",
      variant_id: "67890",
      title: "Product Name",
      variant_title: "Size: Large",
      quantity: 2,
      price: 150.00,
      sku: "PROD-001",
      vendor: "Brand Name"
    }
  ],
  
  shopify_data: {
    shop_domain: "your-store.myshopify.com",
    financial_status: "paid",
    fulfillment_status: "unfulfilled",
    tags: "vip, first-order",
    note: "Please gift wrap"
  },
  
  webhook_received_at: "2026-01-10T12:35:00Z",
  processed: true,
  
  // Matched tracking data (added after processing)
  matched_clicks: [
    {
      product_id: "12345",
      product_name: "Product Name",
      clicked_at: "2026-01-10T12:30:00Z"
    }
  ],
  click_count: 5
}
```

### Indexes
- `session_id` (for fast session lookups)
- `order_id` (unique, prevents duplicates)
- `created_at` (for time-based queries)

---

## 🔐 Security: HMAC Verification (Production)

For production, verify that webhooks actually come from Shopify:

### 1. Get your Webhook Secret
- Shopify Admin → Settings → Notifications → Webhooks
- Click on your webhook → Copy the **Signing Secret**

### 2. Add to environment variables
```bash
export SHOPIFY_WEBHOOK_SECRET="your-secret-here"
```

### 3. Enable verification in code
The `verifyShopifyWebhook()` function is already included in `server.js`.

Uncomment these lines in the webhook handler:
```javascript
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
if (SHOPIFY_WEBHOOK_SECRET) {
  const isValid = verifyShopifyWebhook(req.body, hmacHeader, SHOPIFY_WEBHOOK_SECRET);
  if (!isValid) {
    console.error(`[${requestId}] ❌ Invalid HMAC signature`);
    return res.status(401).json({ error: "Unauthorized" });
  }
}
```

---

## 📈 Analytics Use Cases

### 1. Search-to-Purchase Funnel
```javascript
// Get all activity for a session
const sessionId = "sess-1234-abc";

// 1. Get searches
GET /queries?session_id=${sessionId}

// 2. Get clicks
GET /product-clicks/by-session/${sessionId}

// 3. Get purchases
GET /checkout-events?session_id=${sessionId}

// Result: Complete funnel from search → click → purchase
```

### 2. Product Performance
```javascript
// Which products are clicked but not purchased?
// Which products convert best?
// Compare clicks vs. purchases per product
```

### 3. Revenue Attribution
```javascript
// Link revenue back to specific search queries
// Calculate ROI of AI search vs. traditional search
// Identify high-value search terms
```

---

## 🐛 Troubleshooting

### Webhook not received
1. Check Shopify webhook status (Admin → Notifications → Webhooks)
2. Look for failed deliveries (Shopify shows errors)
3. Verify URL is publicly accessible (not localhost)
4. Check server logs for incoming requests

### Session not matched
1. Verify `session_id` is in cart attributes or note_attributes
2. Check that `getTrackingSessionId()` is called before checkout
3. Look in MongoDB `checkout_events` - is `session_id` null?

### Duplicate orders
- The handler checks for existing `order_id` before inserting
- Shopify may retry webhooks if response is slow
- Duplicates are automatically skipped

---

## 🚀 Deployment Checklist

- [ ] Webhook URL configured in Shopify
- [ ] Session tracking added to checkout flow
- [ ] HMAC verification enabled (production)
- [ ] MongoDB indexes created (automatic on first webhook)
- [ ] Test order completed successfully
- [ ] Verify data in `checkout_events` collection
- [ ] Test analytics endpoints with API key

---

## 📞 Support

For issues or questions:
- Check server logs: `pm2 logs dashboard-server`
- Test webhook manually with Postman
- Verify Shopify webhook deliveries in admin panel

---

**Last Updated**: January 10, 2026
**API Version**: v1.0

