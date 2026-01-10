#!/bin/bash

# Test Shopify Webhook - Order Created
# Usage: ./test-shopify-webhook.sh [local|production]

ENV=${1:-local}

if [ "$ENV" = "production" ]; then
  URL="https://api.semantix-ai.com/webhooks/shopify/order-created"
else
  URL="http://localhost:8080/webhooks/shopify/order-created"
fi

echo "🧪 Testing Shopify webhook: $URL"
echo ""

# Sample Shopify order payload with session tracking
PAYLOAD='{
  "id": 5234567890,
  "order_number": 1234,
  "name": "#1234",
  "created_at": "2026-01-10T12:34:56Z",
  "currency": "ILS",
  "total_price": "450.00",
  "subtotal_price": "420.00",
  "total_tax": "30.00",
  "financial_status": "paid",
  "fulfillment_status": "unfulfilled",
  "tags": "test, webhook",
  "note": "Test order from webhook",
  
  "customer": {
    "id": 123456,
    "email": "test@example.com",
    "first_name": "Test",
    "last_name": "Customer",
    "phone": "+972501234567"
  },
  
  "line_items": [
    {
      "product_id": 12345,
      "variant_id": 67890,
      "title": "Test Product 1",
      "variant_title": "Size: Large",
      "quantity": 2,
      "price": "150.00",
      "sku": "TEST-001",
      "vendor": "Test Vendor"
    },
    {
      "product_id": 12346,
      "variant_id": 67891,
      "title": "Test Product 2",
      "variant_title": "Color: Red",
      "quantity": 1,
      "price": "120.00",
      "sku": "TEST-002",
      "vendor": "Test Vendor"
    }
  ],
  
  "note_attributes": [
    {
      "name": "session_id",
      "value": "sess-test-1234567890-abc"
    },
    {
      "name": "custom_note",
      "value": "Test webhook integration"
    }
  ]
}'

echo "📦 Sending test order webhook..."
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Shop-Domain: test-store.myshopify.com" \
  -H "X-Shopify-Topic: orders/create" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "📊 Response:"
echo "Status Code: $HTTP_CODE"
echo ""
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Webhook test PASSED!"
else
  echo "❌ Webhook test FAILED!"
  exit 1
fi

