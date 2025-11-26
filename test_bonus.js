// Test script to check exact match bonuses
function calculateStringSimilarity(str1, str2) {
  if (str1 === str2) return 1;

  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

function getExactMatchBonus(productName, query, cleanedQuery) {
  if (!productName || !query) return 0;

  const productNameLower = productName.toLowerCase().trim();
  const queryLower = query.toLowerCase().trim();
  const cleanedQueryLower = cleanedQuery ? cleanedQuery.toLowerCase().trim() : '';

  // Exact match - highest priority (boosted significantly)
  if (productNameLower === queryLower) {
    return 100000; // MASSIVE boost for exact match (was 50000)
  }

  // Cleaned query exact match
  if (cleanedQueryLower && productNameLower === cleanedQueryLower) {
    return 90000; // Very high boost (was 45000)
  }

  // Product name contains full query
  if (productNameLower.includes(queryLower)) {
    return 60000; // High boost for text matches (was 30000)
  }

  // Product name contains cleaned query
  if (cleanedQueryLower && productNameLower.includes(cleanedQueryLower)) {
    return 50000; // (was 25000)
  }

  // Multi-word phrase match
  const queryWords = queryLower.split(/\s+/);
  if (queryWords.length > 1) {
    const queryPhrase = queryWords.join(' ');
    if (productNameLower.includes(queryPhrase)) {
      return 40000; // (was 20000)
    }
  }

  // NEAR EXACT MATCHES - More forgiving matching for partial/high similarity matches
  // Single word query with high similarity
  if (queryWords.length === 1) {
    const queryWord = queryWords[0];
    // Query word is prefix of product name
    if (productNameLower.startsWith(queryWord)) {
      return 30000; // (was 15000)
    }
    // Product name starts with query word
    if (queryWord.length >= 3 && productNameLower.startsWith(queryWord)) {
      return 24000; // (was 12000)
    }
    // Query word appears early in product name
    const wordPosition = productNameLower.indexOf(queryWord);
    if (wordPosition >= 0 && wordPosition <= 20) {
      return 20000; // Near exact for words appearing early (was 10000)
    }
  }

  // Multi-word partial matches
  if (queryWords.length > 1) {
    let matchedWords = 0;
    for (const word of queryWords) {
      if (word.length > 2 && productNameLower.includes(word)) {
        matchedWords++;
      }
    }
    // If 70% or more of query words are found
    if (matchedWords >= Math.ceil(queryWords.length * 0.7)) {
      return 15000;
    }
    // If at least 2 words match in a multi-word query
    if (matchedWords >= 2) {
      return 12000;
    }
  }

  // Fuzzy similarity for short queries
  if (queryLower.length >= 3 && productNameLower.length >= 3) {
    // Check similarity against the start of the product name
    const prefixSimilarity = calculateStringSimilarity(queryLower, productNameLower.substring(0, Math.min(30, productNameLower.length)));
    if (prefixSimilarity >= 0.75) {
      console.log(`[DEBUG] Fuzzy prefix match: "${queryLower}" vs "${productNameLower.substring(0, Math.min(30, productNameLower.length))}" = ${prefixSimilarity}`);
      return 10000; // Near exact for high similarity
    }

    // ALSO check similarity against individual words in the product name
    // This helps find "פלם" when searching "פלאם" even if it's not at the start
    const productWords = productNameLower.split(/\s+/);
    for (const word of productWords) {
      if (word.length >= 3) {
        const wordSimilarity = calculateStringSimilarity(queryLower, word);
        // LOWER threshold to 0.75 to catch "פלאם" (4 chars) vs "פלם" (3 chars) - distance 1, length 4 -> 0.75
        // This ensures slight misspellings or variants get the bonus
        if (wordSimilarity >= 0.75) {
          console.log(`[DEBUG] Fuzzy word match: "${queryLower}" vs "${word}" = ${wordSimilarity}`);
          return 12000; // High bonus for fuzzy word match
        }
      }
    }
  }

  return 0;
}

console.log('Testing exact match bonuses:');
console.log('סרנדה vs פוארטה סראדה רוזה:', getExactMatchBonus('פוארטה סראדה רוזה', 'סרנדה', 'סרנדה'));
console.log('סרנדה vs פוארטה סראדה אדום:', getExactMatchBonus('פוארטה סראדה אדום', 'סרנדה', 'סרנדה'));
console.log('סרנדה vs פוארטה סראדה לבן:', getExactMatchBonus('פוארטה סראדה לבן', 'סרנדה', 'סרנדה'));

// Test the similarity function directly
console.log('\nDirect similarity tests:');
console.log('calculateStringSimilarity("סרנדה", "סראדה"):', calculateStringSimilarity('סרנדה', 'סראדה'));
console.log('calculateStringSimilarity("סרנדה", "פוארטה"):', calculateStringSimilarity('סרנדה', 'פוארטה'));
