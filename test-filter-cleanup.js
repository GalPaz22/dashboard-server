// Test the cleanFilters function
function cleanFilters(filters) {
  if (!filters || typeof filters !== 'object') {
    return filters;
  }

  Object.keys(filters).forEach(key => {
    const value = filters[key];
    // Remove undefined, null, empty strings, and whitespace-only strings
    if (value === undefined || value === null || value === '' || (typeof value === 'string' && value.trim() === '')) {
      delete filters[key];
    }
    // Remove empty arrays
    else if (Array.isArray(value) && value.length === 0) {
      delete filters[key];
    }
    // Remove arrays that only contain empty/null/undefined values
    else if (Array.isArray(value)) {
      const cleanedArray = value.filter(v => {
        if (v === undefined || v === null || v === '') return false;
        if (typeof v === 'string' && v.trim() === '') return false;
        return true;
      });
      if (cleanedArray.length === 0) {
        delete filters[key];
      } else if (cleanedArray.length !== value.length) {
        // Update with cleaned array if we removed some values
        filters[key] = cleanedArray;
      }
    }
  });

  return filters;
}

// Test cases
console.log('Testing cleanFilters function...\n');

// Test 1: Empty array should be removed
let test1 = { category: [], type: 'wine' };
cleanFilters(test1);
console.log('Test 1 - Empty array removal:');
console.log('  Input:  { category: [], type: "wine" }');
console.log('  Output:', JSON.stringify(test1));
console.log('  Expected: { type: "wine" }');
console.log('  Result:', JSON.stringify(test1) === JSON.stringify({ type: 'wine' }) ? 'PASS ✓' : 'FAIL ✗');
console.log();

// Test 2: Array with empty strings should be removed
let test2 = { category: ['', ' ', null, undefined], type: 'wine' };
cleanFilters(test2);
console.log('Test 2 - Array with empty/null/undefined values:');
console.log('  Input:  { category: ["", " ", null, undefined], type: "wine" }');
console.log('  Output:', JSON.stringify(test2));
console.log('  Expected: { type: "wine" }');
console.log('  Result:', JSON.stringify(test2) === JSON.stringify({ type: 'wine' }) ? 'PASS ✓' : 'FAIL ✗');
console.log();

// Test 3: Array with some valid values should be cleaned
let test3 = { category: ['יין', '', null, 'וודקה'], type: 'wine' };
cleanFilters(test3);
console.log('Test 3 - Array with mixed valid/invalid values:');
console.log('  Input:  { category: ["יין", "", null, "וודקה"], type: "wine" }');
console.log('  Output:', JSON.stringify(test3));
console.log('  Expected: { category: ["יין", "וודקה"], type: "wine" }');
console.log('  Result:', JSON.stringify(test3) === JSON.stringify({ category: ['יין', 'וודקה'], type: 'wine' }) ? 'PASS ✓' : 'FAIL ✗');
console.log();

// Test 4: Undefined and null values should be removed
let test4 = { category: undefined, type: null, price: 100 };
cleanFilters(test4);
console.log('Test 4 - Undefined and null values:');
console.log('  Input:  { category: undefined, type: null, price: 100 }');
console.log('  Output:', JSON.stringify(test4));
console.log('  Expected: { price: 100 }');
console.log('  Result:', JSON.stringify(test4) === JSON.stringify({ price: 100 }) ? 'PASS ✓' : 'FAIL ✗');
console.log();

// Test 5: Empty string should be removed
let test5 = { category: '', type: 'wine' };
cleanFilters(test5);
console.log('Test 5 - Empty string:');
console.log('  Input:  { category: "", type: "wine" }');
console.log('  Output:', JSON.stringify(test5));
console.log('  Expected: { type: "wine" }');
console.log('  Result:', JSON.stringify(test5) === JSON.stringify({ type: 'wine' }) ? 'PASS ✓' : 'FAIL ✗');
console.log();

// Test 6: Valid values should be preserved
let test6 = { category: ['יין אדום', 'וודקה'], type: 'wine', price: 100 };
const test6Before = JSON.stringify(test6);
cleanFilters(test6);
console.log('Test 6 - Valid values preserved:');
console.log('  Input:  { category: ["יין אדום", "וודקה"], type: "wine", price: 100 }');
console.log('  Output:', JSON.stringify(test6));
console.log('  Expected: Same as input');
console.log('  Result:', JSON.stringify(test6) === test6Before ? 'PASS ✓' : 'FAIL ✗');
console.log();

console.log('All tests completed!');
