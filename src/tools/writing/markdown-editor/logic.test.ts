import { describe, it, expect } from 'vitest'
import {
  countTokensGpt,
  countTokensApprox,
  countWords,
  countChars,
  countLines,
  generateDocTitle,
  pruneAutoVersions,
  formatVersionTime,
} from './logic'

// ---------------------------------------------------------------------------
// countTokensGpt
// ---------------------------------------------------------------------------
describe('countTokensGpt', () => {
  it('returns 0 for empty string', () => {
    expect(countTokensGpt('')).toBe(0)
  })

  it('returns a positive integer for non-empty text', () => {
    const n = countTokensGpt('Hello, world!')
    expect(n).toBeGreaterThan(0)
    expect(Number.isInteger(n)).toBe(true)
  })

  it('counts more tokens for longer text', () => {
    const short = countTokensGpt('Hello')
    const long = countTokensGpt('Hello world this is a longer sentence with many tokens')
    expect(long).toBeGreaterThan(short)
  })
})

// ---------------------------------------------------------------------------
// countTokensApprox
// ---------------------------------------------------------------------------
describe('countTokensApprox', () => {
  it('returns 0 for empty string', () => {
    expect(countTokensApprox('')).toBe(0)
  })

  it('approximates tokens as chars / 3.8 rounded', () => {
    expect(countTokensApprox('abcd')).toBe(Math.round(4 / 3.8))
    expect(countTokensApprox('a'.repeat(38))).toBe(Math.round(38 / 3.8))
  })

  it('returns a positive integer for non-empty text', () => {
    expect(countTokensApprox('Hello')).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------
describe('countWords', () => {
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0)
  })

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   \n\t  ')).toBe(0)
  })

  it('counts a single word', () => {
    expect(countWords('hello')).toBe(1)
  })

  it('counts multiple words separated by spaces', () => {
    expect(countWords('the quick brown fox')).toBe(4)
  })

  it('handles multiple spaces between words', () => {
    expect(countWords('foo   bar')).toBe(2)
  })

  it('handles newlines between words', () => {
    expect(countWords('line one\nline two\nline three')).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// countChars
// ---------------------------------------------------------------------------
describe('countChars', () => {
  it('returns 0 for empty string', () => {
    expect(countChars('')).toBe(0)
  })

  it('returns the raw length of the string', () => {
    expect(countChars('hello')).toBe(5)
    expect(countChars('hello world')).toBe(11)
  })

  it('includes whitespace in the count', () => {
    expect(countChars('  ')).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// countLines
// ---------------------------------------------------------------------------
describe('countLines', () => {
  it('returns 0 for empty string', () => {
    expect(countLines('')).toBe(0)
  })

  it('returns 1 for a single line with no newline', () => {
    expect(countLines('hello')).toBe(1)
  })

  it('returns 2 for two lines', () => {
    expect(countLines('line one\nline two')).toBe(2)
  })

  it('counts trailing newline as an extra segment', () => {
    expect(countLines('line one\n')).toBe(2)
  })

  it('counts 3 lines', () => {
    expect(countLines('a\nb\nc')).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// pruneAutoVersions
// ---------------------------------------------------------------------------

describe('pruneAutoVersions', () => {
  function makeVersions(specs: Array<{ id: string; auto: boolean }>) {
    return specs.map((s) => ({ ...s, content: '', savedAt: 0 }))
  }

  it('returns empty array unchanged', () => {
    expect(pruneAutoVersions([])).toEqual([])
  })

  it('keeps all versions when under cap', () => {
    const vs = makeVersions([
      { id: 'a', auto: true },
      { id: 'b', auto: true },
      { id: 'c', auto: false },
    ])
    expect(pruneAutoVersions(vs, 50)).toHaveLength(3)
  })

  it('never removes pinned versions regardless of cap', () => {
    const vs = makeVersions([
      { id: 'pin1', auto: false },
      { id: 'pin2', auto: false },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, auto: true })),
    ])
    const result = pruneAutoVersions(vs, 3)
    // All 2 pinned survive; only first 3 auto survive
    expect(result.filter((v) => !v.auto)).toHaveLength(2)
    expect(result.filter((v) => v.auto)).toHaveLength(3)
  })

  it('trims oldest auto-versions beyond cap (assumes newest-first order)', () => {
    const vs = makeVersions([
      { id: 'newest', auto: true },
      { id: 'middle', auto: true },
      { id: 'oldest', auto: true },
    ])
    const result = pruneAutoVersions(vs, 2)
    expect(result.map((v) => v.id)).toEqual(['newest', 'middle'])
  })

  it('does not mutate the original array', () => {
    const vs = makeVersions([
      { id: 'a', auto: true },
      { id: 'b', auto: true },
      { id: 'c', auto: true },
    ])
    const original = [...vs]
    pruneAutoVersions(vs, 1)
    expect(vs).toEqual(original)
  })
})

// ---------------------------------------------------------------------------
// formatVersionTime
// ---------------------------------------------------------------------------

describe('formatVersionTime', () => {
  const NOW = 1_700_000_000_000 // fixed reference time

  it('returns "Just now" for timestamps within the last minute', () => {
    expect(formatVersionTime(NOW - 30_000, NOW)).toBe('Just now')
  })

  it('returns "N min ago" for timestamps within the hour', () => {
    expect(formatVersionTime(NOW - 5 * 60_000, NOW)).toBe('5 min ago')
    expect(formatVersionTime(NOW - 59 * 60_000, NOW)).toBe('59 min ago')
  })

  it('returns "Nh ago" for timestamps within the same day', () => {
    expect(formatVersionTime(NOW - 2 * 3_600_000, NOW)).toBe('2h ago')
    expect(formatVersionTime(NOW - 23 * 3_600_000, NOW)).toBe('23h ago')
  })

  it('returns "Yesterday at HH:MM" for timestamps 1 day ago', () => {
    const result = formatVersionTime(NOW - 86_400_000, NOW)
    expect(result).toMatch(/^Yesterday at \d{1,2}:\d{2}/)
  })

  it('returns "N days ago" for timestamps 2–6 days ago', () => {
    expect(formatVersionTime(NOW - 3 * 86_400_000, NOW)).toBe('3 days ago')
    expect(formatVersionTime(NOW - 6 * 86_400_000, NOW)).toBe('6 days ago')
  })

  it('returns a date string for timestamps 7+ days ago', () => {
    const result = formatVersionTime(NOW - 10 * 86_400_000, NOW)
    // Should contain "at HH:MM" and some date portion
    expect(result).toMatch(/at \d{1,2}:\d{2}/)
  })
})

// ---------------------------------------------------------------------------
// generateDocTitle
// ---------------------------------------------------------------------------
describe('generateDocTitle', () => {
  it('returns "Untitled 1" when no existing titles', () => {
    expect(generateDocTitle([])).toBe('Untitled 1')
  })

  it('returns "Untitled 2" when "Untitled 1" is taken', () => {
    expect(generateDocTitle(['Untitled 1'])).toBe('Untitled 2')
  })

  it('fills gaps — skips taken numbers', () => {
    expect(generateDocTitle(['Untitled 1', 'Untitled 2', 'Untitled 3'])).toBe('Untitled 4')
  })

  it('fills a gap when an intermediate title is missing', () => {
    expect(generateDocTitle(['Untitled 1', 'Untitled 3'])).toBe('Untitled 2')
  })

  it('ignores non-matching titles', () => {
    expect(generateDocTitle(['My Prompt', 'System Prompt'])).toBe('Untitled 1')
  })
})
