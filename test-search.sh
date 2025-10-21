#!/bin/bash
curl -s -X POST http://localhost:8000/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: semantix_688736e523c0352ad78525fe_1753691812345" \
  -d '{"query": "יין אדום", "context": "wine store"}' | \
  python3 -c "import sys, json; data = json.load(sys.stdin); print('Products:', len(data['products'])); print('Has More:', data['pagination']['hasMore']); print('Auto Load More:', data['pagination']['autoLoadMore']); print('Has Token:', 'Yes' if data['pagination'].get('secondBatchToken') else 'No')"
