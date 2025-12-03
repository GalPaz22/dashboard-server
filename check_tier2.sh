#!/bin/bash

# Quick check for tier 2 tracking
# Usage: ./check_tier2.sh <mongodb_uri> <db_name>

MONGO_URI="${1:-mongodb://localhost:27017}"
DB_NAME="${2:-your_db_name}"

echo "Checking tier2_tracking collection in $DB_NAME..."
echo ""

mongosh "$MONGO_URI/$DB_NAME" --quiet --eval "
  print('📦 tier2_tracking collection:');
  print('Total records: ' + db.tier2_tracking.countDocuments());
  print('');
  print('Sample records:');
  db.tier2_tracking.find().limit(3).forEach(doc => {
    print('  Query: ' + doc.query);
    print('  Products: ' + (doc.tier2_products ? doc.tier2_products.length : 0));
    print('  Timestamp: ' + doc.timestamp);
    print('');
  });

  print('📦 Recent cart additions:');
  db.cart.find().sort({created_at: -1}).limit(3).forEach(doc => {
    print('  Query: ' + doc.search_query);
    print('  Product ID: ' + doc.product_id);
    print('  tier2Product: ' + doc.tier2Product);
    print('  tier2Upsell: ' + doc.tier2Upsell);
    print('  Has search_results: ' + (doc.search_results ? 'Yes' : 'No'));
    print('');
  });
"
