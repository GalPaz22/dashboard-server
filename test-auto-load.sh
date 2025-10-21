#!/bin/bash
# First get a token from the initial search
TOKEN=$(curl -s -X POST http://localhost:8000/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: semantix_688736e523c0352ad78525fe_1753691812345" \
  -d '{"query": "יין אדום", "context": "wine store"}' | \
  python3 -c "import sys, json; data = json.load(sys.stdin); print(data['pagination']['secondBatchToken'])")

echo "Got token: ${TOKEN:0:50}..."
echo ""
echo "Testing auto-load-more endpoint..."
curl -s "http://localhost:8000/search/auto-load-more?token=$TOKEN" | \
  python3 -c "import sys, json; data = json.load(sys.stdin); print('Products:', len(data.get('products', []))); print('Batch Number:', data.get('pagination', {}).get('batchNumber')); print('Execution Time:', data.get('metadata', {}).get('executionTime'), 'ms')"
