#!/bin/bash
echo "=== Testing Full Auto-Load Flow ==="
echo ""
echo "1. Initial Search..."
RESPONSE=$(curl -s -X POST http://localhost:8000/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: semantix_688736e523c0352ad78525fe_1753691812345" \
  -d '{"query": "יין אדום", "context": "wine store"}')

echo "$RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin); print('  Products:', len(data.get('products', []))); print('  Has More:', data.get('pagination', {}).get('hasMore')); print('  Auto-Load:', data.get('pagination', {}).get('autoLoadMore'))"

TOKEN=$(echo "$RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data['pagination']['secondBatchToken'])")

echo ""
echo "2. Token received (first 80 chars):"
echo "  $TOKEN" | cut -c1-80

echo ""
echo "3. Calling auto-load-more..."
sleep 1

curl -s "http://localhost:8000/search/auto-load-more?token=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$TOKEN'''))")" | \
  python3 -c "import sys, json; data = json.load(sys.stdin); print('  Products:', len(data.get('products', [])) if 'products' in data else 'ERROR'); print('  Error:', data.get('error', 'None')); print('  Message:', data.get('message', 'None'))" 2>&1 || echo "  Failed to parse JSON response"

