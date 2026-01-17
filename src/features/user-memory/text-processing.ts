/**
 * Text Processing Module
 *
 * Provides text normalization, stemming, and synonym expansion
 * for enhanced semantic similarity calculation.
 */

// ============================================================================
// Stopwords
// ============================================================================

/**
 * Common English stopwords that don't contribute to meaning
 */
export const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
  "be", "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare", "ought",
  "used", "this", "that", "these", "those", "i", "you", "he", "she", "it",
  "we", "they", "what", "which", "who", "whom", "whose", "where", "when",
  "why", "how", "all", "each", "every", "both", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "just", "also", "now", "here", "there",
])

// ============================================================================
// Minimal Porter Stemmer
// ============================================================================

/**
 * Minimal Porter Stemmer implementation
 * Handles common English suffixes for normalization
 */
export function stem(word: string): string {
  if (word.length < 3) return word

  let w = word.toLowerCase()

  // Step 1a: plurals
  if (w.endsWith("sses")) w = w.slice(0, -2)
  else if (w.endsWith("ies")) w = w.slice(0, -2)
  else if (w.endsWith("ss")) { /* keep */ }
  else if (w.endsWith("s")) w = w.slice(0, -1)

  // Step 1b: -ed, -ing
  if (w.endsWith("eed")) {
    if (w.length > 4) w = w.slice(0, -1)
  } else if (w.endsWith("ed")) {
    const base = w.slice(0, -2)
    if (/[aeiou]/.test(base)) w = base
  } else if (w.endsWith("ing")) {
    const base = w.slice(0, -3)
    if (/[aeiou]/.test(base)) w = base
  }

  // Step 1c: y -> i
  if (w.endsWith("y") && w.length > 2 && !/[aeiou]/.test(w[w.length - 2])) {
    w = w.slice(0, -1) + "i"
  }

  // Step 2: common suffixes
  const step2Suffixes: [string, string][] = [
    ["ational", "ate"],
    ["tional", "tion"],
    ["enci", "ence"],
    ["anci", "ance"],
    ["izer", "ize"],
    ["isation", "ize"],
    ["ization", "ize"],
    ["ation", "ate"],
    ["ator", "ate"],
    ["alism", "al"],
    ["iveness", "ive"],
    ["fulness", "ful"],
    ["ousness", "ous"],
    ["aliti", "al"],
    ["iviti", "ive"],
    ["biliti", "ble"],
  ]

  for (const [suffix, replacement] of step2Suffixes) {
    if (w.endsWith(suffix) && w.length > suffix.length + 2) {
      w = w.slice(0, -suffix.length) + replacement
      break
    }
  }

  // Step 3: -icate, -ative, -alize, -iciti, -ical, -ful, -ness
  const step3Suffixes: [string, string][] = [
    ["icate", "ic"],
    ["ative", ""],
    ["alize", "al"],
    ["iciti", "ic"],
    ["ical", "ic"],
    ["ful", ""],
    ["ness", ""],
  ]

  for (const [suffix, replacement] of step3Suffixes) {
    if (w.endsWith(suffix) && w.length > suffix.length + 2) {
      w = w.slice(0, -suffix.length) + replacement
      break
    }
  }

  // Step 4: remove -al, -ance, -ence, -er, -ic, -able, -ible, -ant, -ement, -ment, -ent, -ion, -ou, -ism, -ate, -iti, -ous, -ive, -ize
  const step4Suffixes = [
    "al", "ance", "ence", "er", "ic", "able", "ible", "ant",
    "ement", "ment", "ent", "ion", "ou", "ism", "ate", "iti", "ous", "ive", "ize",
  ]

  for (const suffix of step4Suffixes) {
    if (w.endsWith(suffix) && w.length > suffix.length + 3) {
      w = w.slice(0, -suffix.length)
      break
    }
  }

  // Step 5: final cleanup
  if (w.endsWith("e") && w.length > 3) {
    w = w.slice(0, -1)
  }
  if (w.endsWith("ll") && w.length > 3) {
    w = w.slice(0, -1)
  }

  return w
}

// ============================================================================
// Domain-Specific Synonyms
// ============================================================================

/**
 * Synonym groups for software development domain
 * Each array contains terms that should be considered equivalent
 */
const SYNONYM_GROUPS: string[][] = [
  // Naming conventions
  ["snake_case", "underscore", "underscores", "snake-case", "snakecase"],
  ["camelcase", "camelCase", "camel-case", "camel_case"],
  ["pascalcase", "PascalCase", "pascal-case"],
  ["kebab-case", "kebab_case", "kebabcase", "hyphenated"],

  // API/REST
  ["api", "endpoint", "route", "handler"],
  ["rest", "restful", "http"],
  ["request", "req"],
  ["response", "res"],
  ["get", "fetch", "retrieve"],
  ["post", "create", "add"],
  ["put", "update", "modify", "patch"],
  ["delete", "remove", "destroy"],

  // Code structure
  ["function", "func", "fn", "method"],
  ["variable", "var", "let", "const"],
  ["parameter", "param", "arg", "argument"],
  ["return", "returns", "output"],
  ["import", "require", "include"],
  ["export", "module"],

  // Testing
  ["test", "spec", "unittest"],
  ["mock", "stub", "fake", "spy"],
  ["assert", "expect", "should"],

  // Error handling
  ["error", "err", "exception", "throw"],
  ["try", "catch", "finally"],
  ["handle", "handler", "handling"],

  // Async
  ["async", "await", "promise", "asynchronous"],
  ["callback", "cb"],
  ["then", "resolve"],

  // Types
  ["type", "interface", "typedef"],
  ["string", "str", "text"],
  ["number", "num", "int", "integer", "float"],
  ["boolean", "bool"],
  ["array", "list", "arr"],
  ["object", "obj", "dict", "dictionary", "map"],

  // Documentation
  ["comment", "doc", "documentation", "jsdoc", "docstring"],
  ["readme", "docs", "documentation"],

  // Version control
  ["commit", "push", "merge"],
  ["branch", "fork"],
  ["pr", "mr"],  // Multi-word "pull request"/"merge request" removed (can't match after tokenization)

  // Build/Deploy
  ["build", "compile", "bundle"],
  ["deploy", "release", "publish"],
  ["ci", "pipeline"],  // Multi-word phrases removed
]

/**
 * Build a lookup map from synonym to canonical form (first in group)
 */
const SYNONYM_MAP: Map<string, string> = new Map()
for (const group of SYNONYM_GROUPS) {
  const canonical = group[0].toLowerCase()
  for (const synonym of group) {
    SYNONYM_MAP.set(synonym.toLowerCase().replace(/[_-]/g, ""), canonical)
  }
}

/**
 * Get the canonical form of a word (or the word itself if no synonym)
 */
export function getCanonicalForm(word: string): string {
  const normalized = word.toLowerCase().replace(/[_-]/g, "")
  return SYNONYM_MAP.get(normalized) ?? word.toLowerCase()
}

// ============================================================================
// Text Preprocessing
// ============================================================================

/**
 * Preprocess text for comparison:
 * 1. Lowercase
 * 2. Replace underscores/hyphens with spaces
 * 3. Tokenize
 * 4. Remove stopwords
 * 5. Stem each word
 * 6. Map to canonical synonyms
 */
export function preprocessText(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[_-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map(stem)
      .map(getCanonicalForm)
  )
}

/**
 * Expand a word set with synonyms
 */
export function expandWithSynonyms(words: Set<string>): Set<string> {
  const expanded = new Set(words)

  for (const word of words) {
    // Find all words in the same synonym group
    for (const group of SYNONYM_GROUPS) {
      const lowerGroup = group.map((s) => s.toLowerCase().replace(/[_-]/g, ""))
      if (lowerGroup.includes(word.toLowerCase())) {
        for (const synonym of lowerGroup) {
          expanded.add(synonym)
        }
        break
      }
    }
  }

  return expanded
}

/**
 * Extract n-grams from text
 */
export function extractNgrams(text: string, n: number): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)

  const ngrams = new Set<string>()
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(" "))
  }

  return ngrams
}
