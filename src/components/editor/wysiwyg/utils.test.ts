/**
 * wysiwyg/utils.test.ts
 *
 * Tests for wysiwyg/utils.ts pure helpers.
 * normalizeUrl tests live in ../../wysiwyg-utils.test.ts (unchanged).
 * This file tests the selection-rect helpers and re-exports.
 */

import { describe, it, expect } from 'vitest'
import { normalizeUrl } from './utils'

describe('normalizeUrl (re-exported from wysiwyg-utils)', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeUrl('')).toBe('')
  })

  it('prepends https:// to bare domains', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
  })

  it('leaves https:// URLs unchanged', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
  })

  it('blocks javascript: scheme', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe('')
  })

  it('leaves relative paths unchanged', () => {
    expect(normalizeUrl('/foo/bar')).toBe('/foo/bar')
    expect(normalizeUrl('./relative')).toBe('./relative')
  })

  it('leaves mailto: unchanged', () => {
    expect(normalizeUrl('mailto:user@example.com')).toBe('mailto:user@example.com')
  })
})
