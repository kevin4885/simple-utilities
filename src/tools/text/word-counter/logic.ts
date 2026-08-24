/**
 * Word & Character Counter — pure logic (no React, no side-effects)
 *
 * Exports:
 *   countChars        — character statistics (total, no-spaces, letters, digits, punctuation, whitespace)
 *   countWords        — Unicode-aware word count (Intl.Segmenter with regex fallback)
 *   countSentences    — Unicode-aware sentence count (Intl.Segmenter with regex fallback)
 *   countParagraphs   — non-empty blocks separated by blank lines
 *   countLines        — total line count
 *   readingTime       — estimated reading time in seconds (@225 wpm)
 *   speakingTime      — estimated speaking time in seconds (@150 wpm)
 *   formatDuration    — format seconds into a friendly string ("~2 min 30 sec")
 *   wordFrequency     — top-N most common words, optionally excluding stopwords
 *   STOPWORDS         — built-in English stopword set
 */

// ── Character stats ───────────────────────────────────────────────────────────

export interface CharStats {
  /** Total character count (includes whitespace). */
  total: number
  /** Characters excluding whitespace. */
  noSpaces: number
  /** Unicode letters (any script). */
  letters: number
  /** Decimal digit characters. */
  digits: number
  /** Punctuation / symbol characters (non-letter, non-digit, non-whitespace). */
  punctuation: number
  /** Whitespace characters (space, tab, newline, etc.). */
  whitespace: number
}

/**
 * Count character statistics for the given text.
 *
 * Counts are per Unicode code point (via for...of iteration), so astral
 * characters (emoji, mathematical symbols, rare CJK extensions) are counted
 * as a single character rather than two UTF-16 code units. The 'whitespace'
 * category is limited to space separators (\\p{Zs}) and control characters
 * (\\p{Cc}) -- i.e. actual whitespace like space, tab, newline. Format chars
 * like zero-width joiners are classified as punctuation.
 */
export function countChars(text: string): CharStats {
  if (!text) {
    return { total: 0, noSpaces: 0, letters: 0, digits: 0, punctuation: 0, whitespace: 0 }
  }

  let letters = 0
  let digits = 0
  let whitespace = 0
  let punctuation = 0
  let total = 0

  for (const ch of text) {
    total++
    if (/\p{L}/u.test(ch)) {
      letters++
    } else if (/\p{Nd}/u.test(ch)) {
      digits++
    } else if (/\p{Zs}|\p{Cc}/u.test(ch)) {
      // Separator (space, line, para) or control (includes \n, \t, \r)
      whitespace++
    } else {
      // Everything else: punctuation, symbols, emoji components, etc.
      punctuation++
    }
  }

  const noSpaces = total - whitespace

  return { total, noSpaces, letters, digits, punctuation, whitespace }
}

// ── Word count ────────────────────────────────────────────────────────────────

/** True if Intl.Segmenter supports granularity 'word'. */
export function segmenterSupported(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof (Intl as any).Segmenter === 'function'
  } catch {
    return false
  }
}

/**
 * Count words in text.
 *
 * Primary: Intl.Segmenter with granularity 'word', filtering segments where
 * isWordLike === true.
 *
 * Fallback (environments without Intl.Segmenter): split on non-word-character
 * boundaries, filtering empty tokens and pure-punctuation tokens.
 */
export function countWords(text: string): number {
  if (!text.trim()) return 0

  if (segmenterSupported()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seg = new (Intl as any).Segmenter(undefined, { granularity: 'word' })
    let count = 0
    for (const s of seg.segment(text)) {
      if (s.isWordLike) count++
    }
    return count
  }

  // Regex fallback: split on whitespace, keep tokens that contain at least one
  // word character (letter, digit, or underscore).
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => /\w/.test(w)).length
}

// ── Sentence count ────────────────────────────────────────────────────────────

/**
 * Count sentences in text.
 *
 * Primary: Intl.Segmenter with granularity 'sentence', counting segments that
 * contain at least one letter or digit in any Unicode script (avoids counting
 * trailing whitespace segments as sentences, and correctly handles non-Latin
 * scripts such as CJK, Cyrillic, Arabic, Greek, etc.).
 *
 * Fallback: split on sentence-terminating punctuation followed by whitespace /
 * end-of-string, filter empty tokens.
 */
export function countSentences(text: string): number {
  if (!text.trim()) return 0

  if (segmenterSupported()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seg = new (Intl as any).Segmenter(undefined, { granularity: 'sentence' })
    let count = 0
    for (const s of seg.segment(text)) {
      // Use Unicode-aware check so non-Latin scripts (CJK, Cyrillic, etc.) count.
      if (/[\p{L}\p{N}]/u.test(s.segment)) count++
    }
    return count
  }

  // Regex fallback: split on sentence-terminal punctuation
  return text
    .split(/[.!?]+(?:\s+|$)/)
    .filter((s) => s.trim().length > 0).length
}

// ── Paragraph count ───────────────────────────────────────────────────────────

/**
 * Count non-empty paragraphs. A paragraph is a block of text separated from
 * other blocks by one or more blank lines (lines containing only whitespace).
 */
export function countParagraphs(text: string): number {
  if (!text.trim()) return 0
  return text
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0).length
}

// ── Line count ────────────────────────────────────────────────────────────────

/**
 * Count lines. An empty string has 0 lines; a string with no newlines has 1
 * line; "a\nb" has 2 lines; "a\n" has 2 lines (trailing newline creates an
 * empty final line).
 */
export function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

// ── Reading / speaking time ───────────────────────────────────────────────────

const READING_WPM = 225
const SPEAKING_WPM = 150

/**
 * Estimated reading time in seconds at 225 wpm.
 * Returns 0 for empty text.
 */
export function readingTime(wordCount: number): number {
  if (wordCount <= 0) return 0
  return Math.round((wordCount / READING_WPM) * 60)
}

/**
 * Estimated speaking time in seconds at 150 wpm.
 * Returns 0 for empty text.
 */
export function speakingTime(wordCount: number): number {
  if (wordCount <= 0) return 0
  return Math.round((wordCount / SPEAKING_WPM) * 60)
}

/**
 * Format a duration given in seconds into a human-friendly string.
 *
 * Examples:
 *   0         → "< 1 sec"
 *   1         → "~1 sec"
 *   59        → "~59 sec"
 *   60        → "~1 min"
 *   90        → "~1 min 30 sec"
 *   3600      → "~60 min"
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '< 1 sec'

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60

  if (mins === 0) return `~${secs} sec`
  if (secs === 0) return `~${mins} min`
  return `~${mins} min ${secs} sec`
}

// ── Stopword list ─────────────────────────────────────────────────────────────

/**
 * A small but practical English stopword set.
 * All entries are lowercase.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // Articles
  'a', 'an', 'the',
  // Conjunctions
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  // Prepositions
  'at', 'by', 'in', 'of', 'on', 'to', 'up', 'as', 'off', 'out', 'per',
  'via', 'from', 'into', 'onto', 'over', 'than', 'with', 'upon', 'about',
  'above', 'after', 'along', 'among', 'among', 'around', 'before', 'behind',
  'below', 'beneath', 'beside', 'between', 'beyond', 'during', 'except',
  'inside', 'near', 'outside', 'since', 'through', 'throughout', 'under',
  'until', 'without', 'within',
  // Pronouns
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', "you're", "you've", "you'll", "you'd", 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', "it's", 'its', 'itself',
  'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', "that'll",
  'these', 'those',
  // Auxiliary verbs
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing',
  'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'can', 'could',
  // Contractions (common)
  "i'm", "i've", "i'll", "i'd",
  "we're", "we've", "we'll", "we'd",
  "he's", "he'd", "he'll",
  "she's", "she'd", "she'll",
  "they're", "they've", "they'll", "they'd",
  "it's", "isn't", "aren't", "wasn't", "weren't",
  "don't", "doesn't", "didn't",
  "won't", "wouldn't", "can't", "couldn't", "shouldn't", "mustn't",
  "there's", "there're",
  // Common adverbs / filler
  'not', 'no', 'nor', 'so', 'just', 'very', 'too', 'also', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'only', 'own', 'same', 'then', 'than', 'once',
  'any', 'many', 'much', 'now', 'even', 'still', 'well',
])

// ── Word frequency ────────────────────────────────────────────────────────────

export interface WordFrequencyEntry {
  word: string
  count: number
}

/**
 * Compute the top-N most frequent words in the text.
 *
 * - Case-insensitive (words lowercased before counting).
 * - Tokens are extracted with the same word-segmentation strategy as countWords.
 * - When excludeStopwords is true, words in STOPWORDS are excluded.
 * - Returns up to `topN` entries, sorted descending by count.
 *   Ties are broken alphabetically.
 */
export function wordFrequency(
  text: string,
  options: { excludeStopwords: boolean; topN: number } = { excludeStopwords: true, topN: 10 },
): WordFrequencyEntry[] {
  const { excludeStopwords, topN } = options
  if (!text.trim()) return []

  const freq = new Map<string, number>()

  if (segmenterSupported()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seg = new (Intl as any).Segmenter(undefined, { granularity: 'word' })
    for (const s of seg.segment(text)) {
      if (!s.isWordLike) continue
      const w = s.segment.toLowerCase()
      if (excludeStopwords && STOPWORDS.has(w)) continue
      freq.set(w, (freq.get(w) ?? 0) + 1)
    }
  } else {
    // Regex fallback
    const tokens = text
      .trim()
      .split(/\s+/)
      .filter((w) => /\w/.test(w))
    for (const token of tokens) {
      const w = token.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '')
      if (!w) continue
      if (excludeStopwords && STOPWORDS.has(w)) continue
      freq.set(w, (freq.get(w) ?? 0) + 1)
    }
  }

  return Array.from(freq.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, topN)
}

// ── Stats summary (for copy) ──────────────────────────────────────────────────

export interface TextStats {
  chars: CharStats
  words: number
  sentences: number
  paragraphs: number
  lines: number
  readingSecs: number
  speakingSecs: number
}

/**
 * Compute all statistics for the given text in a single pass.
 */
export function computeStats(text: string): TextStats {
  const words = countWords(text)
  return {
    chars: countChars(text),
    words,
    sentences: countSentences(text),
    paragraphs: countParagraphs(text),
    lines: countLines(text),
    readingSecs: readingTime(words),
    speakingSecs: speakingTime(words),
  }
}

/**
 * Build a plain-text summary of the given stats suitable for copying.
 */
export function buildStatsSummary(stats: TextStats): string {
  const lines: string[] = [
    `Words:                  ${stats.words}`,
    `Characters:             ${stats.chars.total}`,
    `Characters (no spaces): ${stats.chars.noSpaces}`,
    `Sentences:              ${stats.sentences}`,
    `Paragraphs:             ${stats.paragraphs}`,
    `Lines:                  ${stats.lines}`,
    `Letters:                ${stats.chars.letters}`,
    `Digits:                 ${stats.chars.digits}`,
    `Punctuation:            ${stats.chars.punctuation}`,
    `Whitespace:             ${stats.chars.whitespace}`,
    `Reading time:           ${formatDuration(stats.readingSecs)}`,
    `Speaking time:          ${formatDuration(stats.speakingSecs)}`,
  ]
  return lines.join('\n')
}
