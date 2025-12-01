#!/bin/bash

# Test Tier 2 Product Embedding Enhancement
# This script tests the new embedding similarity feature in tier 2 results

echo "=========================================="
echo "Tier 2 Embedding Enhancement Test"
echo "=========================================="
echo ""

# Test 1: Query with strong textual match
echo "TEST 1: Query with exact textual match (should capture embeddings)"
echo "Query: סאוזן קומפורט (should match 'ליקר סאוטרן קומפורט')"
echo ""
curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -H "x-api-key: test" \
  -H "X-Pagination-Mode: modern" \
  -d '{
    "query": "סאוזן קומפורט",
    "limit": 25
  }' 2>/dev/null | jq -r '.pagination.nextToken' > /tmp/tier2_token.txt

echo "✅ Tier 1 complete. Check logs for:"
echo "   🧬 Found X high-quality textual matches for embedding similarity"
echo "   🧬 Extracted X product embeddings for tier-2 similarity search"
echo ""
read -p "Press Enter to load tier 2..."
echo ""

# Load tier 2
TIER2_TOKEN=$(cat /tmp/tier2_token.txt)
echo "TEST 1 - TIER 2: Loading more results..."
echo ""
curl -X GET "http://localhost:3000/search/load-more?token=${TIER2_TOKEN}&limit=25" \
  -H "x-api-key: test" 2>/dev/null | jq '.products[0:3] | .[] | {name: .name, category: .category}'

echo ""
echo "✅ Tier 2 complete. Check logs for:"
echo "   🧬 TIER-2 ENHANCEMENT: Finding products similar to X high-quality tier-1 matches"
echo "   🧬 Found X products via embedding similarity to tier-1 matches"
echo "   🧬 TIER-2 MERGED: X total products (soft category + similarity)"
echo "   🧬 Products found via BOTH methods: X"
echo ""
echo "=========================================="
echo ""

# Test 2: Complex multi-attribute query
echo "TEST 2: Complex query with multiple attributes"
echo "Query: יין אדום ישראלי חצי יבש"
echo ""
curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -H "x-api-key: test" \
  -H "X-Pagination-Mode: modern" \
  -d '{
    "query": "יין אדום ישראלי חצי יבש",
    "limit": 25
  }' 2>/dev/null | jq -r '.pagination.nextToken' > /tmp/tier2_token2.txt

echo "✅ Tier 1 complete. Check logs for embedding extraction"
echo ""
read -p "Press Enter to load tier 2..."
echo ""

# Load tier 2
TIER2_TOKEN2=$(cat /tmp/tier2_token2.txt)
echo "TEST 2 - TIER 2: Loading more results..."
echo ""
curl -X GET "http://localhost:3000/search/load-more?token=${TIER2_TOKEN2}&limit=25" \
  -H "x-api-key: test" 2>/dev/null | jq '.products[0:5] | .[] | {name: .name, category: .category}'

echo ""
echo "✅ Tier 2 complete. Verify:"
echo "   - All products are from 'יין אדום' category (hard filter respected)"
echo "   - Products include both soft category matches AND similar products"
echo "   - Check category distribution in logs"
echo ""
echo "=========================================="
echo ""

# Test 3: Query without strong textual matches
echo "TEST 3: Query without exact matches (should fall back to soft categories only)"
echo "Query: יין מיוחד לארוחת שישי"
echo ""
curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -H "x-api-key: test" \
  -H "X-Pagination-Mode: modern" \
  -d '{
    "query": "יין מיוחד לארוחת שישי",
    "limit": 25
  }' 2>/dev/null | jq -r '.pagination.nextToken' > /tmp/tier2_token3.txt

echo "✅ Tier 1 complete. Check logs - should NOT see embedding extraction"
echo ""
read -p "Press Enter to load tier 2..."
echo ""

# Load tier 2
TIER2_TOKEN3=$(cat /tmp/tier2_token3.txt)
echo "TEST 3 - TIER 2: Loading more results..."
echo ""
curl -X GET "http://localhost:3000/search/load-more?token=${TIER2_TOKEN3}&limit=25" \
  -H "x-api-key: test" 2>/dev/null | jq '.products[0:3] | .[] | {name: .name, category: .category}'

echo ""
echo "✅ Tier 2 complete. Verify:"
echo "   - No embedding similarity logs (no high-quality textual matches in tier 1)"
echo "   - Tier 2 uses soft categories only (traditional behavior)"
echo ""
echo "=========================================="
echo "All tests complete!"
echo ""
echo "Summary of what to check in logs:"
echo "1. Tier 1 should capture product embeddings when exactMatchBonus >= 50,000"
echo "2. Tier 2 should run ANN search using those embeddings"
echo "3. Results should merge soft category + embedding similarity"
echo "4. Products found via BOTH methods should be counted"
echo "5. Hard category filters must be respected (check category distribution)"

