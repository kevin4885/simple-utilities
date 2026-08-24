/**
 * Word & Character Counter — logic unit tests
 */

import { describe, it, expect } from 'vitest'
import {
  countChars,
  countWords,
  countSentences,
  countParagraphs,
  countLines,
  readingTime,
  speakingTime,
  formatDuration,
  wordFrequency,
  computeStats,
  segmenterSupported,
  STOPWORDS,
} from './logic'

// ── helpers ───────────────────────────────────────────────────────────────────

const HAS_SEGMENTER = segmenterSupported()

// ── countChars ────────────────────────────────────────────────────────────────

describe('countChars', () => {
  it('returns all zeros for empty string', () => {
    const r = countChars('')
    expect(r.total).toBe(0)
    expect(r.noSpaces).toBe(0)
    expect(r.letters).toBe(0)
    expect(r.digits).toBe(0)
    expect(r.punctuation).toBe(0)
    expect(r.whitespace).toBe(0)
  })

  it('counts a simple ASCII sentence', () => {
    // "Hello, World!" — 13 chars: 10 letters, 2 punct (,!), 1 space
    const r = countChars('Hello, World!')
    expect(r.total).toBe(13)
    expect(r.letters).toBe(10)
    expect(r.punctuation).toBe(2)
    expect(r.whitespace).toBe(1)
    expect(r.noSpaces).toBe(12)
    expect(r.digits).toBe(0)
  })

  it('counts digits correctly', () => {
    const r = countChars('abc 123')
    expect(r.letters).toBe(3)
    expect(r.digits).toBe(3)
    expect(r.whitespace).toBe(1)
  })

  it('counts newlines as whitespace', () => {
    const r = countChars('a\nb\n')
    expect(r.whitespace).toBe(2)
    expect(r.letters).toBe(2)
    expect(r.total).toBe(4)
  })

  it('counts tabs as whitespace', () => {
    const r = countChars('a\tb')
    expect(r.whitespace).toBe(1)
  })

  it('total = letters + digits + punctuation + whitespace', () => {
    const text = 'Hello, World! 42\nFoo.'
    const r = countChars(text)
    expect(r.letters + r.digits + r.punctuation + r.whitespace).toBe(r.total)
  })

  it('handles Unicode letters (accented)', () => {
    // "café" — 4 letters (c, a, f, é)
    const r = countChars('café')
    expect(r.letters).toBe(4)
    expect(r.total).toBe(4)
  })

  it('handles Unicode letters (CJK)', () => {
    // "你好" — 2 CJK characters, counted as letters
    const r = countChars('你好')
    expect(r.letters).toBe(2)
  })

  it('handles mixed punctuation', () => {
    const r = countChars('...!!??')
    expect(r.punctuation).toBe(7)
    expect(r.letters).toBe(0)
  })

  it('noSpaces = total - whitespace', () => {
    const text = 'The quick brown fox'
    const r = countChars(text)
    expect(r.noSpaces).toBe(r.total - r.whitespace)
  })
})

// ── countWords ────────────────────────────────────────────────────────────────

describe('countWords', () => {
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0)
  })

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   \n\t  ')).toBe(0)
  })

  it('counts basic English words', () => {
    expect(countWords('Hello world')).toBe(2)
  })

  it('counts a single word', () => {
    expect(countWords('word')).toBe(1)
  })

  it('handles multiple spaces between words', () => {
    expect(countWords('one   two   three')).toBe(3)
  })

  it('handles leading and trailing whitespace', () => {
    expect(countWords('  hello world  ')).toBe(2)
  })

  it('counts contraction as one word (don\'t)', () => {
    // Segmenter-aware: "don't" is 1 word-like segment
    // Regex fallback: split on whitespace → "don't" is 1 token
    const count = countWords("don't")
    expect(count).toBe(1)
  })

  it('counts "it\'s" as one word', () => {
    expect(countWords("it's fine")).toBe(2)
  })

  it('handles punctuation attached to words', () => {
    expect(countWords('Hello, world!')).toBe(2)
  })

  it('handles numbers as words', () => {
    expect(countWords('42 is the answer')).toBe(4)
  })

  it('handles mixed newlines', () => {
    expect(countWords('one\ntwo\nthree')).toBe(3)
  })

  it('handles accented characters (café)', () => {
    const count = countWords('café au lait')
    expect(count).toBe(3)
  })

  it('handles hyphenated words', () => {
    // "well-known" — Segmenter may split into 3 (well + - + known) or 1;
    // regex fallback counts it as 1. We just verify a positive count.
    const count = countWords('well-known fact')
    expect(count).toBeGreaterThanOrEqual(2)
  })

  it('handles CJK text (if Segmenter available)', () => {
    if (!HAS_SEGMENTER) return
    // CJK characters may each be word-like depending on the segmenter.
    const count = countWords('你好世界')
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('counts a paragraph correctly', () => {
    const text = 'The quick brown fox jumps over the lazy dog.'
    expect(countWords(text)).toBe(9)
  })
})

// ── countSentences ────────────────────────────────────────────────────────────

describe('countSentences', () => {
  it('returns 0 for empty string', () => {
    expect(countSentences('')).toBe(0)
  })

  it('returns 0 for whitespace-only', () => {
    expect(countSentences('  \n  ')).toBe(0)
  })

  it('counts a single sentence', () => {
    expect(countSentences('Hello world.')).toBe(1)
  })

  it('counts two sentences', () => {
    expect(countSentences('Hello world. How are you?')).toBe(2)
  })

  it('counts three sentences', () => {
    expect(countSentences('One. Two. Three.')).toBe(3)
  })

  it('handles exclamation marks', () => {
    expect(countSentences('Wow! That is great.')).toBe(2)
  })

  it('handles sentence without trailing punctuation', () => {
    // One sentence, no terminal punct
    const count = countSentences('This is a sentence')
    expect(count).toBe(1)
  })

  it('handles multiple punctuation marks (ellipsis)', () => {
    // "Wait... really?" — 1 or 2 depending on segmenter, but at least 1
    const count = countSentences('Wait... really?')
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('counts Cyrillic sentences correctly (if Segmenter available)', () => {
    if (!HAS_SEGMENTER) return
    // The Unicode-aware filter /[\p{L}\p{N}]/u must match Cyrillic letters
    const count = countSentences('Привет мир. Как дела?')
    expect(count).toBe(2)
  })

  it('counts CJK sentences correctly (if Segmenter available)', () => {
    if (!HAS_SEGMENTER) return
    // The Unicode-aware filter must match CJK characters
    const count = countSentences('你好世界。再见世界。')
    expect(count).toBe(2)
  })

})

// ── countParagraphs ───────────────────────────────────────────────────────────

describe('countParagraphs', () => {
  it('returns 0 for empty string', () => {
    expect(countParagraphs('')).toBe(0)
  })

  it('returns 0 for whitespace-only', () => {
    expect(countParagraphs('  \n  \n  ')).toBe(0)
  })

  it('returns 1 for single paragraph (no blank lines)', () => {
    expect(countParagraphs('Hello world.')).toBe(1)
  })

  it('returns 1 for multi-line paragraph (no blank line separator)', () => {
    expect(countParagraphs('Line one\nLine two\nLine three')).toBe(1)
  })

  it('returns 2 for two paragraphs separated by a blank line', () => {
    expect(countParagraphs('Para one.\n\nPara two.')).toBe(2)
  })

  it('returns 3 for three paragraphs', () => {
    expect(countParagraphs('Para one.\n\nPara two.\n\nPara three.')).toBe(3)
  })

  it('ignores multiple consecutive blank lines', () => {
    // Three blank lines between two paragraphs still = 2 paragraphs
    expect(countParagraphs('Para one.\n\n\n\nPara two.')).toBe(2)
  })

  it('ignores leading/trailing blank lines', () => {
    expect(countParagraphs('\n\nPara one.\n\n')).toBe(1)
  })

  it('handles whitespace-only blank lines between paragraphs', () => {
    expect(countParagraphs('Para one.\n   \nPara two.')).toBe(2)
  })
})

// ── countLines ────────────────────────────────────────────────────────────────

describe('countLines', () => {
  it('returns 0 for empty string', () => {
    expect(countLines('')).toBe(0)
  })

  it('returns 1 for a string with no newlines', () => {
    expect(countLines('Hello')).toBe(1)
  })

  it('returns 2 for "a\\nb"', () => {
    expect(countLines('a\nb')).toBe(2)
  })

  it('returns 2 for "a\\n" (trailing newline creates empty final line)', () => {
    expect(countLines('a\n')).toBe(2)
  })

  it('returns 3 for two newlines', () => {
    expect(countLines('one\ntwo\nthree')).toBe(3)
  })

  it('counts blank lines too', () => {
    expect(countLines('one\n\nthree')).toBe(3)
  })
})

// ── readingTime / speakingTime ────────────────────────────────────────────────

describe('readingTime', () => {
  it('returns 0 for 0 words', () => {
    expect(readingTime(0)).toBe(0)
  })

  it('returns 0 for negative word count', () => {
    expect(readingTime(-5)).toBe(0)
  })

  it('225 words → ~60 seconds (1 min)', () => {
    expect(readingTime(225)).toBe(60)
  })

  it('450 words → ~120 seconds (2 min)', () => {
    expect(readingTime(450)).toBe(120)
  })

  it('1 word → 0 seconds (rounds to 0)', () => {
    // 1/225 * 60 ≈ 0.27 seconds → rounds to 0
    expect(readingTime(1)).toBe(0)
  })

  it('113 words → ~30 seconds', () => {
    // 113/225 * 60 ≈ 30.1 → 30
    expect(readingTime(113)).toBe(30)
  })
})

describe('speakingTime', () => {
  it('returns 0 for 0 words', () => {
    expect(speakingTime(0)).toBe(0)
  })

  it('150 words → ~60 seconds (1 min)', () => {
    expect(speakingTime(150)).toBe(60)
  })

  it('300 words → ~120 seconds (2 min)', () => {
    expect(speakingTime(300)).toBe(120)
  })
})

// ── formatDuration ────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('0 seconds → "< 1 sec"', () => {
    expect(formatDuration(0)).toBe('< 1 sec')
  })

  it('negative seconds → "< 1 sec"', () => {
    expect(formatDuration(-5)).toBe('< 1 sec')
  })

  it('1 second → "~1 sec"', () => {
    expect(formatDuration(1)).toBe('~1 sec')
  })

  it('59 seconds → "~59 sec"', () => {
    expect(formatDuration(59)).toBe('~59 sec')
  })

  it('60 seconds → "~1 min"', () => {
    expect(formatDuration(60)).toBe('~1 min')
  })

  it('90 seconds → "~1 min 30 sec"', () => {
    expect(formatDuration(90)).toBe('~1 min 30 sec')
  })

  it('120 seconds → "~2 min"', () => {
    expect(formatDuration(120)).toBe('~2 min')
  })

  it('150 seconds → "~2 min 30 sec"', () => {
    expect(formatDuration(150)).toBe('~2 min 30 sec')
  })

  it('3600 seconds → "~60 min"', () => {
    expect(formatDuration(3600)).toBe('~60 min')
  })

  it('3661 seconds → "~61 min 1 sec"', () => {
    expect(formatDuration(3661)).toBe('~61 min 1 sec')
  })
})

// ── wordFrequency ─────────────────────────────────────────────────────────────

describe('wordFrequency', () => {
  it('returns [] for empty string', () => {
    expect(wordFrequency('', { excludeStopwords: true, topN: 10 })).toEqual([])
  })

  it('returns [] for whitespace-only', () => {
    expect(wordFrequency('  \n  ', { excludeStopwords: true, topN: 10 })).toEqual([])
  })

  it('counts words case-insensitively', () => {
    const result = wordFrequency('Apple apple APPLE', { excludeStopwords: false, topN: 10 })
    expect(result).toHaveLength(1)
    expect(result[0].word).toBe('apple')
    expect(result[0].count).toBe(3)
  })

  it('returns top-N entries', () => {
    const text = 'a b c d e f g h i j k'.split(' ').join(' ')
    const result = wordFrequency(text, { excludeStopwords: false, topN: 3 })
    expect(result.length).toBeLessThanOrEqual(3)
  })

  it('sorts by count descending', () => {
    const text = 'cat dog cat cat dog bird'
    const result = wordFrequency(text, { excludeStopwords: false, topN: 10 })
    expect(result[0].word).toBe('cat')
    expect(result[0].count).toBe(3)
    expect(result[1].word).toBe('dog')
    expect(result[1].count).toBe(2)
  })

  it('breaks ties alphabetically', () => {
    const text = 'apple banana apple banana'
    const result = wordFrequency(text, { excludeStopwords: false, topN: 10 })
    expect(result[0].word).toBe('apple')
    expect(result[1].word).toBe('banana')
    expect(result[0].count).toBe(result[1].count)
  })

  it('excludes stopwords when flag is true', () => {
    const text = 'the cat sat on the mat'
    const result = wordFrequency(text, { excludeStopwords: true, topN: 10 })
    const words = result.map((e) => e.word)
    expect(words).not.toContain('the')
    expect(words).not.toContain('on')
    expect(words).toContain('cat')
    expect(words).toContain('sat')
    expect(words).toContain('mat')
  })

  it('includes stopwords when flag is false', () => {
    const text = 'the cat sat on the mat'
    const result = wordFrequency(text, { excludeStopwords: false, topN: 10 })
    const words = result.map((e) => e.word)
    expect(words).toContain('the')
  })

  it('STOPWORDS set contains common English words', () => {
    expect(STOPWORDS.has('the')).toBe(true)
    expect(STOPWORDS.has('a')).toBe(true)
    expect(STOPWORDS.has('and')).toBe(true)
    expect(STOPWORDS.has('is')).toBe(true)
  })

  it('STOPWORDS does not contain content words', () => {
    expect(STOPWORDS.has('cat')).toBe(false)
    expect(STOPWORDS.has('apple')).toBe(false)
    expect(STOPWORDS.has('running')).toBe(false)
  })

  it('handles numbers in frequency', () => {
    const text = '42 is the answer 42 42'
    const result = wordFrequency(text, { excludeStopwords: true, topN: 10 })
    const entry = result.find((e) => e.word === '42')
    expect(entry).toBeDefined()
    expect(entry!.count).toBe(3)
  })
})

// ── computeStats ─────────────────────────────────────────────────────────────

describe('computeStats', () => {
  it('returns all zeros for empty string', () => {
    const s = computeStats('')
    expect(s.words).toBe(0)
    expect(s.sentences).toBe(0)
    expect(s.paragraphs).toBe(0)
    expect(s.lines).toBe(0)
    expect(s.chars.total).toBe(0)
    expect(s.readingSecs).toBe(0)
    expect(s.speakingSecs).toBe(0)
  })

  it('returns correct stats for a simple sentence', () => {
    const s = computeStats('Hello world.')
    expect(s.words).toBe(2)
    expect(s.sentences).toBe(1)
    expect(s.paragraphs).toBe(1)
    expect(s.lines).toBe(1)
    expect(s.chars.total).toBe(12)
  })

  it('stats are consistent with individual functions', () => {
    const text = 'The quick brown fox.\n\nJumps over the lazy dog.'
    const s = computeStats(text)
    expect(s.words).toBe(countWords(text))
    expect(s.sentences).toBe(countSentences(text))
    expect(s.paragraphs).toBe(countParagraphs(text))
    expect(s.lines).toBe(countLines(text))
    expect(s.chars.total).toBe(countChars(text).total)
  })
})

// ── Unicode edge cases ─────────────────────────────────────────────────────────

describe('Unicode edge cases', () => {
  it('countWords handles emoji (treated as non-word-like by Segmenter)', () => {
    // Emoji are not word-like; "hello 👋 world" should be 2 words
    if (!HAS_SEGMENTER) return
    expect(countWords('hello 👋 world')).toBe(2)
  })

  it('countChars handles multi-codepoint emoji correctly for total count', () => {
    // 👋 is a single emoji but may have multiple code units in JS
    // We just check that some characters are counted
    const r = countChars('hi 👋')
    expect(r.total).toBeGreaterThan(0)
  })

  it('countWords handles text with accents: "naïve café résumé"', () => {
    expect(countWords('naïve café résumé')).toBe(3)
  })

  it('countChars handles accented letters as letters', () => {
    const r = countChars('naïve')
    // n, a, ï, v, e — all letters (5 code units, ï is a single char)
    expect(r.letters).toBe(5)
  })
})
