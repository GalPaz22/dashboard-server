const API_KEY = 'semantix_688736e523c0352ad78525fe_1753691812345';

// Step 1: Initial search
console.log('Step 1: Initial search...');
fetch('http://localhost:8000/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY
  },
  body: JSON.stringify({
    query: 'יין אדום',
    context: 'wine store'
  })
})
.then(res => res.json())
.then(data => {
  console.log('✅ Batch 1 Response:');
  console.log('  Products:', data.products?.length);
  console.log('  Auto-load enabled:', data.pagination?.autoLoadMore);
  console.log('  Has token:', !!data.pagination?.secondBatchToken);
  
  if (data.pagination?.secondBatchToken) {
    const token = data.pagination.secondBatchToken;
    console.log('\nStep 2: Auto-loading batch 2...');
    
    // Step 2: Auto-load batch 2
    setTimeout(() => {
      fetch(`http://localhost:8000/search/auto-load-more?token=${encodeURIComponent(token)}`)
        .then(res => {
          console.log('  Response status:', res.status);
          return res.json();
        })
        .then(data2 => {
          console.log('✅ Batch 2 Response:');
          console.log('  Products:', data2.products?.length);
          console.log('  Error:', data2.error || 'None');
          console.log('  Batch number:', data2.pagination?.batchNumber);
          process.exit(0);
        })
        .catch(err => {
          console.error('❌ Batch 2 Error:', err.message);
          process.exit(1);
        });
    }, 500);
  } else {
    console.log('❌ No second batch token!');
    process.exit(1);
  }
})
.catch(err => {
  console.error('❌ Batch 1 Error:', err.message);
  process.exit(1);
});
