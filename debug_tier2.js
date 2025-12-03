// Debug script to check tier 2 tracking
const { MongoClient } = require('mongodb');

async function debugTier2() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.DB_NAME || 'your_db_name'; // Replace with your actual DB name

  console.log('🔍 Debugging Tier 2 Tracking...\n');

  try {
    const client = await MongoClient.connect(mongoUri);
    const db = client.db(dbName);

    // Check 1: Does tier2_tracking collection exist and have data?
    console.log('📦 CHECK 1: tier2_tracking collection');
    const tier2Collection = db.collection('tier2_tracking');
    const tier2Count = await tier2Collection.countDocuments();
    console.log(`  - Total tier2_tracking records: ${tier2Count}`);

    if (tier2Count > 0) {
      const sampleTier2 = await tier2Collection.find().limit(3).toArray();
      console.log('  - Sample tier2_tracking records:');
      sampleTier2.forEach(record => {
        console.log(`    * Query: "${record.query}"`);
        console.log(`      Products: ${record.tier2_products?.length || 0}`);
        console.log(`      Timestamp: ${record.timestamp}`);
        console.log(`      Sample products: ${record.tier2_products?.slice(0, 3).join(', ')}`);
      });
    } else {
      console.log('  ⚠️  No tier2_tracking records found!');
      console.log('  → Tier 2 products haven\'t been stored yet.');
      console.log('  → Make sure you trigger /search/load-more with tier 2 active.');
    }
    console.log('');

    // Check 2: Recent cart additions
    console.log('📦 CHECK 2: Recent cart additions');
    const cartCollection = db.collection('cart');
    const recentCart = await cartCollection.find().sort({ created_at: -1 }).limit(5).toArray();
    console.log(`  - Total cart records: ${await cartCollection.countDocuments()}`);
    console.log('  - Recent cart additions:');
    recentCart.forEach(cart => {
      console.log(`    * Query: "${cart.search_query}"`);
      console.log(`      Product ID: ${cart.product_id}`);
      console.log(`      upsale: ${cart.upsale}`);
      console.log(`      tier2Product: ${cart.tier2Product}`);
      console.log(`      tier2Upsell: ${cart.tier2Upsell}`);
      console.log(`      search_results provided: ${cart.search_results ? 'Yes (' + cart.search_results.length + ')' : 'No'}`);
    });
    console.log('');

    // Check 3: Check if queries match between tier2_tracking and cart
    console.log('📦 CHECK 3: Query matching');
    if (tier2Count > 0 && recentCart.length > 0) {
      const tier2Queries = new Set((await tier2Collection.find().toArray()).map(r => r.query));
      const cartQueries = new Set(recentCart.map(c => c.search_query));

      console.log('  - Tier 2 queries:', Array.from(tier2Queries));
      console.log('  - Cart queries:', Array.from(cartQueries));

      const matching = [...cartQueries].filter(q => tier2Queries.has(q));
      console.log('  - Matching queries:', matching.length > 0 ? matching : 'None');

      if (matching.length === 0) {
        console.log('  ⚠️  No matching queries! Queries must match exactly.');
      }
    }
    console.log('');

    // Check 4: Check if product names match
    console.log('📦 CHECK 4: Product name matching');
    if (tier2Count > 0 && recentCart.length > 0) {
      const tier2Record = await tier2Collection.findOne();
      if (tier2Record && tier2Record.tier2_products) {
        console.log(`  - Sample tier 2 product names: ${tier2Record.tier2_products.slice(0, 3).join(', ')}`);

        // Get product names from cart
        const productIds = recentCart.map(c => c.product_id).filter(Boolean);
        const productsCollection = db.collection('products');

        for (const productId of productIds.slice(0, 3)) {
          const product = await productsCollection.findOne({
            $or: [
              { ItemID: parseInt(productId) },
              { ItemID: productId.toString() },
              { id: parseInt(productId) },
              { id: productId.toString() },
              { _id: productId }
            ]
          });

          if (product) {
            console.log(`  - Product ID ${productId} → Name: "${product.name}"`);
          } else {
            console.log(`  - Product ID ${productId} → ⚠️  NOT FOUND`);
          }
        }
      }
    }
    console.log('');

    // Summary
    console.log('📋 SUMMARY');
    console.log('─────────────────────────────────────────');
    if (tier2Count === 0) {
      console.log('❌ Issue: No tier2_tracking records found');
      console.log('   Solution: Trigger tier 2 by:');
      console.log('   1. Search for a complex query');
      console.log('   2. Scroll/load more results');
      console.log('   3. Check logs for: "🧬 Stored X tier 2 products"');
    } else if (recentCart.every(c => c.tier2Product === null)) {
      console.log('❌ Issue: All cart records have tier2Product = null');
      console.log('   Possible causes:');
      console.log('   1. Product not found in products collection');
      console.log('   2. search_results not provided in cart request');
      console.log('   3. Error in tier 2 detection (check server logs)');
    } else if (recentCart.some(c => c.tier2Product === false)) {
      console.log('✅ Tier 2 detection is working!');
      console.log('   But no tier 2 products added to cart yet.');
    } else {
      console.log('✅ Everything looks good!');
    }

    await client.close();

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  }
}

// Run if called directly
if (require.main === module) {
  // Get DB name from command line or use default
  if (process.argv[2]) {
    process.env.DB_NAME = process.argv[2];
  }

  debugTier2().then(() => {
    console.log('\n✅ Debug complete');
    process.exit(0);
  }).catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { debugTier2 };
