/**
 * src/lib/content.test.ts
 *
 * Tests for the shared SEO/marketing content module — mainly
 * `truncateDescription`, the pure function shared by the live client hook
 * and the (Phase 2) build-time prerender script.
 */
import { describe, it, expect } from 'vitest'
import { SITE_URL, LANDING_COPY, truncateDescription } from './content'

describe('truncateDescription', () => {
  it('returns a string shorter than max unchanged', () => {
    expect(truncateDescription('short text', 155)).toBe('short text')
  })

  it('returns an empty string unchanged', () => {
    expect(truncateDescription('', 155)).toBe('')
  })

  it('returns a string exactly at max unchanged', () => {
    const text = 'a'.repeat(20)
    expect(truncateDescription(text, 20)).toBe(text)
  })

  it('cuts a longer string at the last full word boundary at or before max', () => {
    const text = 'The quick brown fox jumps over the lazy dog and keeps running'
    const result = truncateDescription(text, 20)
    expect(result.length).toBeLessThanOrEqual(20)
    expect(result).toBe('The quick brown fox')
    // Never mid-word: the character right after the result in the original
    // string must be a word boundary (space), not a continuation of a word.
    expect(text[result.length]).toBe(' ')
  })

  it('never cuts mid-word for a realistic tool description', () => {
    const text =
      'Live word, character, sentence, paragraph, and line counts. Reading and speaking time estimates. ' +
      'Top-10 word frequency table with stopword filter. Copy a plain-text stats summary in one click.'
    const result = truncateDescription(text, 155)
    expect(result.length).toBeLessThanOrEqual(155)
    // Result must be a prefix of the original text, cut at a space.
    expect(text.startsWith(result)).toBe(true)
    const nextChar = text[result.length]
    expect(nextChar === ' ' || nextChar === undefined).toBe(true)
  })

  it('falls back to a hard cut when there is no word boundary within max', () => {
    const text = 'a'.repeat(200)
    const result = truncateDescription(text, 50)
    expect(result).toBe('a'.repeat(50))
  })
})

describe('LANDING_COPY', () => {
  it('has a title and a description no longer than 155 chars', () => {
    expect(LANDING_COPY.title.length).toBeGreaterThan(0)
    expect(LANDING_COPY.description.length).toBeGreaterThan(0)
    expect(LANDING_COPY.description.length).toBeLessThanOrEqual(155)
  })

  it('has at least 3 highlight blurbs', () => {
    expect(LANDING_COPY.highlights.length).toBeGreaterThanOrEqual(3)
    expect(LANDING_COPY.highlights.length).toBeLessThanOrEqual(5)
    for (const h of LANDING_COPY.highlights) {
      expect(h.title.length).toBeGreaterThan(0)
      expect(h.description.length).toBeGreaterThan(0)
    }
  })
})

describe('SITE_URL', () => {
  it('is an absolute https URL with no trailing slash', () => {
    expect(SITE_URL).toBe('https://www.simpleutilities.com')
    expect(SITE_URL.endsWith('/')).toBe(false)
  })
})
