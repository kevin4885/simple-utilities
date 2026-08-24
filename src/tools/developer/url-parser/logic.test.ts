/**
 * URL Parser / Encoder — logic unit tests
 */

import { describe, it, expect } from 'vitest'
import {
  parseUrl,
  paramsToRows,
  rowsToSearchString,
  rebuildUrl,
  safeEncode,
  safeDecode,
  applyEncodeDecodeMode,
} from './logic'
import type { ParsedUrl, ParamRow } from './logic'

// ── parseUrl ──────────────────────────────────────────────────────────────────

describe('parseUrl', () => {
  it('returns error for empty input', () => {
    const r = parseUrl('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBeTruthy()
  })

  it('returns error for whitespace-only input', () => {
    const r = parseUrl('   ')
    expect(r.ok).toBe(false)
  })

  it('parses a simple https URL', () => {
    const r = parseUrl('https://example.com')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.protocol).toBe('https:')
    expect(r.parsed.hostname).toBe('example.com')
    expect(r.parsed.pathname).toBe('/')
    expect(r.parsed.port).toBe('')
    expect(r.addedProtocol).toBe(false)
  })

  it('parses a simple http URL', () => {
    const r = parseUrl('http://example.com/path')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.protocol).toBe('http:')
    expect(r.parsed.pathname).toBe('/path')
  })

  it('adds https:// when no protocol is present', () => {
    const r = parseUrl('example.com/path')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.addedProtocol).toBe(true)
    expect(r.parsed.protocol).toBe('https:')
    expect(r.parsed.hostname).toBe('example.com')
    expect(r.parsed.pathname).toBe('/path')
  })

  it('adds https:// when input starts with www.', () => {
    const r = parseUrl('www.example.com')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.addedProtocol).toBe(true)
    expect(r.parsed.hostname).toBe('www.example.com')
  })

  it('trims leading and trailing whitespace', () => {
    const r = parseUrl('  https://example.com  ')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.hostname).toBe('example.com')
  })

  it('parses an explicit port', () => {
    const r = parseUrl('http://localhost:3000/api')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.port).toBe('3000')
    expect(r.parsed.hostname).toBe('localhost')
    expect(r.parsed.host).toBe('localhost:3000')
    expect(r.parsed.pathname).toBe('/api')
  })

  it('parses username and password', () => {
    const r = parseUrl('https://user:pass@example.com')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.username).toBe('user')
    expect(r.parsed.password).toBe('pass')
  })

  it('decodes percent-encoded username', () => {
    const r = parseUrl('https://my%20user:my%40pass@example.com')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.username).toBe('my user')
    expect(r.parsed.password).toBe('my@pass')
  })

  it('parses a query string', () => {
    const r = parseUrl('https://example.com/search?q=hello&lang=en')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.search).toBe('?q=hello&lang=en')
  })

  it('parses a fragment', () => {
    const r = parseUrl('https://example.com/page#section-2')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.hash).toBe('#section-2')
  })

  it('parses a complex URL with all parts', () => {
    const r = parseUrl('https://user:pw@api.example.com:8443/v1/resource?id=42&fmt=json#top')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.protocol).toBe('https:')
    expect(r.parsed.username).toBe('user')
    expect(r.parsed.password).toBe('pw')
    expect(r.parsed.hostname).toBe('api.example.com')
    expect(r.parsed.port).toBe('8443')
    expect(r.parsed.pathname).toBe('/v1/resource')
    expect(r.parsed.search).toBe('?id=42&fmt=json')
    expect(r.parsed.hash).toBe('#top')
  })

  it('parses a URL with only a hash fragment', () => {
    const r = parseUrl('https://example.com#frag')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.hash).toBe('#frag')
    expect(r.parsed.search).toBe('')
  })

  it('returns error for a genuinely invalid URL', () => {
    const r = parseUrl('not a url at all!!!')
    expect(r.ok).toBe(false)
  })

  it('handles ftp:// protocol', () => {
    const r = parseUrl('ftp://files.example.com/pub/file.txt')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.protocol).toBe('ftp:')
    expect(r.addedProtocol).toBe(false)
  })

  it('does not double-add protocol when already present', () => {
    const r = parseUrl('https://example.com')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.addedProtocol).toBe(false)
    // href should not have double https://
    expect(r.parsed.href).not.toContain('https://https://')
  })
})

// ── paramsToRows ──────────────────────────────────────────────────────────────

describe('paramsToRows', () => {
  it('returns empty array for empty string', () => {
    expect(paramsToRows('')).toEqual([])
  })

  it('parses a single param', () => {
    const rows = paramsToRows('?q=hello')
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('q')
    expect(rows[0].value).toBe('hello')
  })

  it('parses multiple params', () => {
    const rows = paramsToRows('?q=hello&lang=en&page=2')
    expect(rows).toHaveLength(3)
    expect(rows[0].key).toBe('q')
    expect(rows[1].key).toBe('lang')
    expect(rows[2].key).toBe('page')
  })

  it('decodes percent-encoded values', () => {
    const rows = paramsToRows('?q=caf%C3%A9')
    expect(rows).toHaveLength(1)
    expect(rows[0].value).toBe('café')
  })

  it('handles repeated keys as separate rows', () => {
    const rows = paramsToRows('?tag=a&tag=b&tag=c')
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.key === 'tag')).toBe(true)
    expect(rows.map((r) => r.value)).toEqual(['a', 'b', 'c'])
  })

  it('handles empty value', () => {
    const rows = paramsToRows('?key=')
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('key')
    expect(rows[0].value).toBe('')
  })

  it('handles key without equals sign', () => {
    // URLSearchParams treats "?flag" as key="flag", value=""
    const rows = paramsToRows('?flag')
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('flag')
    expect(rows[0].value).toBe('')
  })

  it('gives each row a unique id', () => {
    const rows = paramsToRows('?a=1&b=2&c=3')
    const ids = rows.map((r) => r.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('works without leading ?', () => {
    const rows = paramsToRows('q=hello&lang=en')
    expect(rows).toHaveLength(2)
  })
})

// ── rowsToSearchString ────────────────────────────────────────────────────────

describe('rowsToSearchString', () => {
  it('returns empty string for empty array', () => {
    expect(rowsToSearchString([])).toBe('')
  })

  it('serialises a single row', () => {
    const rows: ParamRow[] = [{ id: '1', key: 'q', value: 'hello' }]
    expect(rowsToSearchString(rows)).toBe('q=hello')
  })

  it('serialises multiple rows', () => {
    const rows: ParamRow[] = [
      { id: '1', key: 'q', value: 'hello' },
      { id: '2', key: 'lang', value: 'en' },
    ]
    const qs = rowsToSearchString(rows)
    expect(qs).toContain('q=hello')
    expect(qs).toContain('lang=en')
  })

  it('percent-encodes special characters', () => {
    const rows: ParamRow[] = [{ id: '1', key: 'q', value: 'café' }]
    const qs = rowsToSearchString(rows)
    expect(qs).toBe('q=caf%C3%A9')
  })

  it('handles repeated keys', () => {
    const rows: ParamRow[] = [
      { id: '1', key: 'tag', value: 'a' },
      { id: '2', key: 'tag', value: 'b' },
    ]
    const qs = rowsToSearchString(rows)
    expect(qs).toBe('tag=a&tag=b')
  })

  it('skips rows with empty key', () => {
    const rows: ParamRow[] = [
      { id: '1', key: '', value: 'orphan' },
      { id: '2', key: 'q', value: 'hello' },
    ]
    const qs = rowsToSearchString(rows)
    expect(qs).toBe('q=hello')
  })

  it('includes rows with empty value', () => {
    const rows: ParamRow[] = [{ id: '1', key: 'flag', value: '' }]
    const qs = rowsToSearchString(rows)
    expect(qs).toBe('flag=')
  })
})

// ── rebuildUrl ────────────────────────────────────────────────────────────────

describe('rebuildUrl', () => {
  function makeParsed(href: string): ParsedUrl {
    const url = new URL(href)
    return {
      href: url.href,
      protocol: url.protocol,
      username: url.username,
      password: url.password,
      hostname: url.hostname,
      port: url.port,
      host: url.host,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
    }
  }

  it('preserves URL when rows match original params', () => {
    const parsed = makeParsed('https://example.com/search?q=hello')
    const rows: ParamRow[] = [{ id: '1', key: 'q', value: 'hello' }]
    const result = rebuildUrl(parsed, rows)
    expect(result).toBe('https://example.com/search?q=hello')
  })

  it('reflects edited value', () => {
    const parsed = makeParsed('https://example.com/?q=hello')
    const rows: ParamRow[] = [{ id: '1', key: 'q', value: 'world' }]
    const result = rebuildUrl(parsed, rows)
    expect(result).toBe('https://example.com/?q=world')
  })

  it('removes query string when all rows are deleted', () => {
    const parsed = makeParsed('https://example.com/?q=hello')
    const result = rebuildUrl(parsed, [])
    expect(result).toBe('https://example.com/')
  })

  it('adds a new param row', () => {
    const parsed = makeParsed('https://example.com/?q=hello')
    const rows: ParamRow[] = [
      { id: '1', key: 'q', value: 'hello' },
      { id: '2', key: 'lang', value: 'en' },
    ]
    const result = rebuildUrl(parsed, rows)
    expect(result).toContain('q=hello')
    expect(result).toContain('lang=en')
  })

  it('preserves hash when rebuilding', () => {
    const parsed = makeParsed('https://example.com/page?x=1#section')
    const rows: ParamRow[] = [{ id: '1', key: 'x', value: '1' }]
    const result = rebuildUrl(parsed, rows)
    expect(result).toContain('#section')
  })

  it('round-trips unicode param values', () => {
    const parsed = makeParsed('https://example.com/?q=caf%C3%A9')
    const rows = paramsToRows(parsed.search)
    // rows[0].value should be 'café' (decoded)
    expect(rows[0].value).toBe('café')
    const result = rebuildUrl(parsed, rows)
    // rebuilt URL should re-encode it
    expect(result).toBe('https://example.com/?q=caf%C3%A9')
  })
})

// ── safeEncode ────────────────────────────────────────────────────────────────

describe('safeEncode', () => {
  it('encodeURIComponent encodes special chars', () => {
    const r = safeEncode('hello world!', 'encodeURIComponent')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('hello%20world!')
  })

  it('encodeURIComponent encodes / and ?', () => {
    const r = safeEncode('/path?q=1', 'encodeURIComponent')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('%2Fpath%3Fq%3D1')
  })

  it('encodeURIComponent handles unicode (café)', () => {
    const r = safeEncode('q=café', 'encodeURIComponent')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('q%3Dcaf%C3%A9')
  })

  it('encodeURI does not encode valid URL chars', () => {
    const r = safeEncode('https://example.com/path?q=1&x=2', 'encodeURI')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // encodeURI should not encode : / ? = &
    expect(r.output).toBe('https://example.com/path?q=1&x=2')
  })

  it('encodeURI encodes spaces', () => {
    const r = safeEncode('https://example.com/path with spaces', 'encodeURI')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toContain('%20')
  })

  it('returns empty output for empty input', () => {
    const r = safeEncode('', 'encodeURIComponent')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('')
  })
})

// ── safeDecode ────────────────────────────────────────────────────────────────

describe('safeDecode', () => {
  it('decodeURIComponent decodes encoded chars', () => {
    const r = safeDecode('hello%20world%21', 'decodeURIComponent')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('hello world!')
  })

  it('decodeURIComponent decodes unicode (café)', () => {
    const r = safeDecode('caf%C3%A9', 'decodeURIComponent')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('café')
  })

  it('decodeURIComponent returns URIError for malformed sequence', () => {
    const r = safeDecode('%ZZ', 'decodeURIComponent')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/malformed percent/i)
  })

  it('decodeURIComponent returns URIError for lone high surrogate', () => {
    // %ED%A0%80 = lone high surrogate U+D800 — invalid UTF-8 sequence
    const r = safeDecode('%ED%A0%80', 'decodeURIComponent')
    expect(r.ok).toBe(false)
  })

  it('decodeURI decodes a full URI', () => {
    const r = safeDecode('https://example.com/path%20with%20spaces?q=caf%C3%A9', 'decodeURI')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('https://example.com/path with spaces?q=café')
  })

  it('decodeURI does not decode reserved chars like %2F', () => {
    // %2F = "/" but decodeURI does not decode it (it's a reserved URI char)
    const r = safeDecode('https://example.com%2Fpath', 'decodeURI')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // decodeURI leaves %2F alone
    expect(r.output).toContain('%2F')
  })

  it('returns empty output for empty input', () => {
    const r = safeDecode('', 'decodeURIComponent')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('')
  })
})

// ── applyEncodeDecodeMode ─────────────────────────────────────────────────────

describe('applyEncodeDecodeMode', () => {
  it('encodeURIComponent mode works', () => {
    const r = applyEncodeDecodeMode('a b', 'encodeURIComponent')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('a%20b')
  })

  it('decodeURIComponent mode works', () => {
    const r = applyEncodeDecodeMode('a%20b', 'decodeURIComponent')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('a b')
  })

  it('encodeURI mode works', () => {
    const r = applyEncodeDecodeMode('https://x.com/a b', 'encodeURI')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('https://x.com/a%20b')
  })

  it('decodeURI mode works', () => {
    const r = applyEncodeDecodeMode('https://x.com/a%20b', 'decodeURI')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('https://x.com/a b')
  })

  it('decodeURIComponent mode surfaces URIError', () => {
    const r = applyEncodeDecodeMode('%GG', 'decodeURIComponent')
    expect(r.ok).toBe(false)
  })

  it('decodeURI mode surfaces URIError', () => {
    // %ZZ is invalid in both modes
    const r = applyEncodeDecodeMode('%ZZ', 'decodeURI')
    expect(r.ok).toBe(false)
  })
})

// ── Round-trip integration ────────────────────────────────────────────────────

describe('round-trip: paramsToRows → rowsToSearchString', () => {
  function roundTrip(search: string): string {
    const rows = paramsToRows(search)
    return rowsToSearchString(rows)
  }

  it('round-trips a simple query', () => {
    // URLSearchParams may change encoding (spaces → +), so compare decoded
    const qs = roundTrip('q=hello&lang=en')
    const parsed = new URLSearchParams(qs)
    expect(parsed.get('q')).toBe('hello')
    expect(parsed.get('lang')).toBe('en')
  })

  it('round-trips repeated keys', () => {
    const qs = roundTrip('tag=a&tag=b&tag=c')
    const parsed = new URLSearchParams(qs)
    expect(parsed.getAll('tag')).toEqual(['a', 'b', 'c'])
  })

  it('round-trips unicode values', () => {
    const qs = roundTrip('q=caf%C3%A9')
    const parsed = new URLSearchParams(qs)
    expect(parsed.get('q')).toBe('café')
  })

  it('round-trips empty value', () => {
    const qs = roundTrip('flag=')
    const parsed = new URLSearchParams(qs)
    expect(parsed.get('flag')).toBe('')
  })
})

describe('round-trip: parseUrl → rebuildUrl preserves URL', () => {
  it('preserves a complex URL', () => {
    const input = 'https://api.example.com:8080/v2/data?q=hello&page=2#results'
    const r = parseUrl(input)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rows = paramsToRows(r.parsed.search)
    const rebuilt = rebuildUrl(r.parsed, rows)
    expect(rebuilt).toBe(input)
  })

  it('editing a value updates the reconstructed URL', () => {
    const input = 'https://example.com/search?q=hello&lang=en'
    const r = parseUrl(input)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rows = paramsToRows(r.parsed.search)
    // Edit first row value
    rows[0] = { ...rows[0], value: 'world' }
    const rebuilt = rebuildUrl(r.parsed, rows)
    expect(rebuilt).toBe('https://example.com/search?q=world&lang=en')
  })
})
