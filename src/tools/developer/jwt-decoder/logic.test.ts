import { describe, it, expect } from 'vitest'
import {
  base64urlDecode,
  base64urlToBytes,
  decodeJwt,
  formatTimestamp,
  isExpired,
  buildClaimInfos,
} from './logic'

// ── Helpers: build a test JWT in pure JS ──────────────────────────────────────

function base64urlEncode(str: string): string {
  // btoa on UTF-8: encode as Uint8Array, then btoa the binary string
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function makeJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  fakeSignature = 'FAKESIG',
): string {
  return [
    base64urlEncode(JSON.stringify(header)),
    base64urlEncode(JSON.stringify(payload)),
    fakeSignature,
  ].join('.')
}

// ── base64urlDecode ───────────────────────────────────────────────────────────

describe('base64urlDecode', () => {
  it('decodes standard ASCII', () => {
    // "hello" in base64url
    expect(base64urlDecode('aGVsbG8')).toBe('hello')
  })

  it('handles base64url alphabet (- and _)', () => {
    // base64url uses - and _ instead of + and /
    // ">" encodes to "Pg==" in standard base64, "Pg" in base64url
    const bytes = base64urlToBytes('Pg')
    expect(bytes[0]).toBe('>'.charCodeAt(0))
  })

  it('handles missing padding', () => {
    // "Man" → "TWFu" (no padding needed), but test with 1 and 2 pad chars
    expect(base64urlDecode('TWFu')).toBe('Man')
    expect(base64urlDecode('TWE')).toBe('Ma')  // 1 pad char
    expect(base64urlDecode('TQ')).toBe('M')    // 2 pad chars
  })

  it('decodes UTF-8 content (accented chars)', () => {
    const original = 'café résumé'
    const encoded = base64urlEncode(original)
    expect(base64urlDecode(encoded)).toBe(original)
  })

  it('decodes UTF-8 content (emoji)', () => {
    const original = '😀 hello'
    const encoded = base64urlEncode(original)
    expect(base64urlDecode(encoded)).toBe(original)
  })
})

// ── decodeJwt ─────────────────────────────────────────────────────────────────

describe('decodeJwt', () => {
  it('decodes a valid JWT', () => {
    const header = { alg: 'HS256', typ: 'JWT' }
    const payload = { sub: '1234', name: 'Alice', iat: 1700000000 }
    const token = makeJwt(header, payload)

    const result = decodeJwt(token)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.header).toEqual(header)
    expect(result.payload).toEqual(payload)
    expect(result.signature).toBe('FAKESIG')
  })

  it('returns formatted JSON', () => {
    const token = makeJwt({ alg: 'RS256' }, { sub: '1' })
    const result = decodeJwt(token)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headerJson).toBe(JSON.stringify({ alg: 'RS256' }, null, 2))
    expect(result.payloadJson).toBe(JSON.stringify({ sub: '1' }, null, 2))
  })

  it('returns error for empty input', () => {
    const r = decodeJwt('')
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toBeTruthy()
  })

  it('returns error for whitespace-only input', () => {
    const r = decodeJwt('   ')
    expect(r.ok).toBe(false)
  })

  it('returns error for too few segments (1)', () => {
    const r = decodeJwt('onlyone')
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(/3 segment/)
  })

  it('returns error for too few segments (2)', () => {
    const r = decodeJwt('one.two')
    expect(r.ok).toBe(false)
  })

  it('returns error for too many segments (4)', () => {
    const r = decodeJwt('a.b.c.d')
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(/4/)
  })

  it('returns error for invalid base64url in header', () => {
    const r = decodeJwt('!!!.eyJzdWIiOiIxIn0.sig')
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(/[Hh]eader/)
  })

  it('returns error for invalid JSON in header', () => {
    // Base64url of "not json"
    const r = decodeJwt(`${base64urlEncode('not json')}.${base64urlEncode('{}')}.sig`)
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(/[Hh]eader/)
  })

  it('returns error for invalid base64url in payload', () => {
    const headerB64 = base64urlEncode(JSON.stringify({ alg: 'HS256' }))
    const r = decodeJwt(`${headerB64}.!!INVALID!!.sig`)
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(/[Pp]ayload/)
  })

  it('handles unicode in claims', () => {
    const payload = { name: 'André Ñoño', note: '日本語テスト', emoji: '😀🎉' }
    const token = makeJwt({ alg: 'HS256' }, payload)
    const r = decodeJwt(token)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload).toEqual(payload)
  })

  it('handles token with leading/trailing whitespace', () => {
    const token = makeJwt({ alg: 'HS256' }, { sub: '1' })
    const r = decodeJwt(`  ${token}  `)
    expect(r.ok).toBe(true)
  })
})

// ── formatTimestamp ───────────────────────────────────────────────────────────

describe('formatTimestamp', () => {
  it('returns a non-empty string for a valid Unix timestamp', () => {
    const result = formatTimestamp(1700000000)
    expect(typeof result).toBe('string')
    expect(result!.length).toBeGreaterThan(0)
  })

  it('returns null for non-numeric values', () => {
    expect(formatTimestamp('1700000000')).toBeNull()
    expect(formatTimestamp(null)).toBeNull()
    expect(formatTimestamp(undefined)).toBeNull()
  })

  it('returns null for non-finite numbers', () => {
    expect(formatTimestamp(Infinity)).toBeNull()
    expect(formatTimestamp(NaN)).toBeNull()
  })
})

// ── isExpired ─────────────────────────────────────────────────────────────────

describe('isExpired', () => {
  it('returns true when exp is in the past', () => {
    const past = Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
    expect(isExpired(past)).toBe(true)
  })

  it('returns false when exp is in the future', () => {
    const future = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
    expect(isExpired(future)).toBe(false)
  })

  it('returns false for non-numeric exp', () => {
    expect(isExpired('123')).toBe(false)
    expect(isExpired(null)).toBe(false)
  })

  it('uses provided nowMs for deterministic testing', () => {
    const nowMs = 1_700_000_000_000 // fixed "now"
    const expiredTs = 1_699_990_000  // before now
    const validTs   = 1_700_010_000  // after now
    expect(isExpired(expiredTs, nowMs)).toBe(true)
    expect(isExpired(validTs, nowMs)).toBe(false)
  })
})

// ── buildClaimInfos ───────────────────────────────────────────────────────────

describe('buildClaimInfos', () => {
  it('annotates iat, exp, nbf with formatted timestamps', () => {
    const nowMs = 1_700_000_000_000
    const payload = { iat: 1_699_990_000, exp: 1_700_010_000, nbf: 1_699_990_000, sub: 'u1' }
    const infos = buildClaimInfos(payload, nowMs)

    const iat = infos.find((c) => c.key === 'iat')
    const exp = infos.find((c) => c.key === 'exp')
    const sub = infos.find((c) => c.key === 'sub')

    expect(iat?.formatted).toBeTruthy()
    expect(exp?.formatted).toBeTruthy()
    expect(exp?.expired).toBe(false) // exp is in future relative to nowMs
    expect(sub?.formatted).toBeUndefined()
  })

  it('marks exp as expired when past', () => {
    const nowMs = 1_700_000_000_000
    const expiredTs = 1_699_990_000
    const infos = buildClaimInfos({ exp: expiredTs }, nowMs)
    expect(infos[0].expired).toBe(true)
  })

  it('does not add formatted for non-timestamp claims', () => {
    const infos = buildClaimInfos({ role: 'admin', sub: '1' })
    expect(infos.every((c) => c.formatted === undefined)).toBe(true)
  })

  it('handles empty payload', () => {
    expect(buildClaimInfos({})).toEqual([])
  })
})
