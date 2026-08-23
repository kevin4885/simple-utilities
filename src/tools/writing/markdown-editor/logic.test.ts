import { describe, it, expect } from 'vitest'
import {
  countTokensGpt,
  countTokensApprox,
  countWords,
  countChars,
  countLines,
  generateDocTitle,
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
