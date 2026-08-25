import { describe, it, expect } from 'vitest'
import { normalizeUrl } from './wysiwyg-utils'

describe('normalizeUrl', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeUrl('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeUrl('   ')).toBe('')
    expect(normalizeUrl('\t\n')).toBe('')
  })

  it('trims whitespace around valid URLs', () => {
    expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com')
  })

  it('leaves https:// URLs alone', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeUrl('https://example.com/path?q=1#anchor')).toBe(
      'https://example.com/path?q=1#anchor',
    )
  })

  it('leaves http:// URLs alone', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
  })

  it('leaves mailto: alone', () => {
    expect(normalizeUrl('mailto:user@example.com')).toBe('mailto:user@example.com')
  })

  it('leaves tel: alone', () => {
    expect(normalizeUrl('tel:+1234567890')).toBe('tel:+1234567890')
  })

  it('leaves data: URIs alone', () => {
    expect(normalizeUrl('data:image/png;base64,abc123==')).toBe(
      'data:image/png;base64,abc123==',
    )
  })

  it('leaves ftp:// alone', () => {
    expect(normalizeUrl('ftp://files.example.com')).toBe('ftp://files.example.com')
  })

  it('leaves #anchors alone', () => {
    expect(normalizeUrl('#section-1')).toBe('#section-1')
    expect(normalizeUrl('#')).toBe('#')
  })

  it('leaves absolute paths alone', () => {
    expect(normalizeUrl('/about')).toBe('/about')
    expect(normalizeUrl('/some/deep/path')).toBe('/some/deep/path')
  })

  it('leaves relative paths alone', () => {
    expect(normalizeUrl('./page')).toBe('./page')
    expect(normalizeUrl('../parent')).toBe('../parent')
  })

  it('prepends https:// to bare domains', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
    expect(normalizeUrl('www.example.com')).toBe('https://www.example.com')
  })

  it('prepends https:// to bare domains with paths', () => {
    expect(normalizeUrl('example.com/path/to/page')).toBe(
      'https://example.com/path/to/page',
    )
  })

  it('prepends https:// to subdomains', () => {
    expect(normalizeUrl('sub.example.co.uk')).toBe('https://sub.example.co.uk')
  })

  // host:port cases — should get https:// prepended, not treated as a scheme
  it('prepends https:// to localhost:port', () => {
    expect(normalizeUrl('localhost:3000')).toBe('https://localhost:3000')
  })

  it('prepends https:// to example.com:8080', () => {
    expect(normalizeUrl('example.com:8080')).toBe('https://example.com:8080')
  })

  // Dangerous scheme blocking
  it('blocks javascript: URIs', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe('')
  })

  it('blocks vbscript: URIs', () => {
    expect(normalizeUrl('vbscript:msgbox(1)')).toBe('')
  })

  it('blocks javascript: URIs with mixed case', () => {
    expect(normalizeUrl('JavaScript:void(0)')).toBe('')
  })
})
