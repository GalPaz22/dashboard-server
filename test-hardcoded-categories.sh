#!/bin/bash

# Test script for hard-coded category extraction
# This tests that "יין" and wine-related queries are properly extracted

API_KEY="semantix_688736e523c0352ad78525fe_1753691812345"
BASE_URL="http://localhost:8000"

echo "================================"
echo "Testing Hard-Coded Category Extraction"
echo "================================"
echo ""

# Test 1: Just "יין" (wine)
echo "Test 1: Query='יין'"
curl -s -X POST ${BASE_URL}/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{"query": "יין", "context": "wine store"}' | \
  python3 -c "import sys, json; data = json.load(sys.stdin); print('  Category extracted:', data.get('filters', {}).get('category', 'NONE')); print('  Products found:', len(data.get('products', [])))"
echo ""

# Test 2: "יין אדום" (red wine)
echo "Test 2: Query='יין אדום'"
curl -s -X POST ${BASE_URL}/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{"query": "יין אדום", "context": "wine store"}' | \
  python3 -c "import sys, json; data = json.load(sys.stdin); print('  Category extracted:', data.get('filters', {}).get('category', 'NONE')); print('  Products found:', len(data.get('products', [])))"
echo ""

# Test 3: "יין לבן" (white wine)
echo "Test 3: Query='יין לבן'"
curl -s -X POST ${BASE_URL}/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{"query": "יין לבן", "context": "wine store"}' | \
  python3 -c "import sys, json; data = json.load(sys.stdin); print('  Category extracted:', data.get('filters', {}).get('category', 'NONE')); print('  Products found:', len(data.get('products', [])))"
echo ""

# Test 4: "wine" (English)
echo "Test 4: Query='wine'"
curl -s -X POST ${BASE_URL}/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{"query": "wine", "context": "wine store"}' | \
  python3 -c "import sys, json; data = json.load(sys.stdin); print('  Category extracted:', data.get('filters', {}).get('category', 'NONE')); print('  Products found:', len(data.get('products', [])))"
echo ""

# Test 5: "red wine" (English)
echo "Test 5: Query='red wine'"
curl -s -X POST ${BASE_URL}/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{"query": "red wine", "context": "wine store"}' | \
  python3 -c "import sys, json; data = json.load(sys.stdin); print('  Category extracted:', data.get('filters', {}).get('category', 'NONE')); print('  Products found:', len(data.get('products', [])))"
echo ""

# Test 6: Complex query with "יין" 
echo "Test 6: Query='יין מתאים לארוחת ערב' (wine suitable for dinner)"
curl -s -X POST ${BASE_URL}/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{"query": "יין מתאים לארוחת ערב", "context": "wine store"}' | \
  python3 -c "import sys, json; data = json.load(sys.stdin); print('  Category extracted:', data.get('filters', {}).get('category', 'NONE')); print('  Products found:', len(data.get('products', [])))"
echo ""

echo "================================"
echo "Tests Complete"
echo "================================"

