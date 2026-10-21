// Normalize a phrase for consistent matching: trim, unify quote chars, lowercase.
function normalizePinnedText(str) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u05F3\u2019\u2018\u02BC\u2032\u00B4\u0060]/g, "'").replace(/[\u05F4\u201C\u201D]/g, '"').replace(/\s+/g, ' ').toLowerCase();
}

// Single-letter Hebrew prefixes (mem, shin, he, vav, kaf, lamed, bet) that
// commonly attach to a word — e.g. "לנשים" = "ל" + "נשים".
const HEBREW_PREFIXES = new Set(['מ', 'ש', 'ה', 'ו', 'כ', 'ל', 'ב']);

// Levenshtein edit distance (small strings only) — tolerates a single typo.
function pinnedEditDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Build the set of comparable keys for a Hebrew word: the mater-lectionis-free
// form (drop optional י/ו), plus a prefix-stripped variant. This lets
// "לנשים" and "נשים" compare equal without over-stripping real words.
function pinnedWordKeys(word) {
  const base = word.replace(/[יו]/g, '');
  const keys = new Set();
  if (base) keys.add(base);
  if (base.length >= 4 && HEBREW_PREFIXES.has(base[0])) {
    keys.add(base.slice(1));
  }
  return keys;
}

// Fuzzy equality between two words: shared key, or a single-typo edit distance
// on the normalized base (only for words long enough to avoid false positives).
function pinnedWordsMatch(ruleWord, queryWord) {
  if (!ruleWord || !queryWord) return ruleWord === queryWord;
  if (ruleWord === queryWord) return true;
  const rKeys = pinnedWordKeys(ruleWord);
  const qKeys = pinnedWordKeys(queryWord);
  for (const k of rKeys) if (qKeys.has(k)) return true;
  const rBase = ruleWord.replace(/[יו]/g, '');
  const qBase = queryWord.replace(/[יו]/g, '');
  if (Math.max(rBase.length, qBase.length) >= 4 && pinnedEditDistance(rBase, qBase) <= 1) return true;
  return false;
}

// Fuzzy CONTAINMENT at the word level: every word of the rule phrase must fuzzy-
// match some word in the query (order-independent, prefix/typo tolerant).
// So "שעון לנשים" also catches "שעון נשים" and "שעון לנשים ספורט".
function pinnedPhraseMatchesQuery(phrase, queryWords) {
  const phraseWords = phrase.split(/\s+/).filter(Boolean);
  if (phraseWords.length === 0) return false;
  return phraseWords.every(pw => queryWords.some(qw => pinnedWordsMatch(pw, qw)));
}

// Find the pinned rule whose phrase fuzzy-matches the query. When several rules
// match, the longest phrase wins (most specific). Returns the rule or null.
export function findPinnedRuleForQuery(query, store) {
  const rules = store?.pinnedResults;
  if (!Array.isArray(rules) || rules.length === 0) return null;

  const normQuery = normalizePinnedText(query);
  if (!normQuery) return null;
  const queryWords = normQuery.split(/\s+/).filter(Boolean);

  let best = null;
  let bestLen = -1;
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    if (!Array.isArray(rule.productIds) || rule.productIds.length === 0) continue;
    // A rule may hold several comma-separated terms — any of them can trigger it.
    for (const rawPhrase of String(rule.query || '').split(',')) {
      const phrase = normalizePinnedText(rawPhrase);
      if (!phrase) continue;
      if (rule.matchType === 'exact' && phrase === normQuery) return rule;
      if (phrase.length > bestLen && (rule.matchType === 'exact' ? phrase === normQuery : pinnedPhraseMatchesQuery(phrase, queryWords))) {
        best = rule;
        bestLen = phrase.length;
      }
    }
  }
  return best;
}
