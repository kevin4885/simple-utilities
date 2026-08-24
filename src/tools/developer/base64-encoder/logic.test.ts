import { describe, it, expect } from 'vitest'
import {
  encodeBase64,
  decodeBase64,
  validateBase64,
  bytesToDataUri,
  formatFileSize,
  estimateBase64Size,
} from './logic'

// ── encodeBase64 ──────────────────────────────────────────────────────────────

describe('encodeBase64 — standard variant', () => {
  it('encodes ASCII text', () => {
    const r = encodeBase64('hello')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('aGVsbG8=')
  })

  it('encodes empty string', () => {
    const r = encodeBase64('')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('')
  })

  it('encodes "Man" (classic textbook example)', () => {
    const r = encodeBase64('Man')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('TWFu')
  })

  it('encodes "Ma" (produces 1 padding char)', () => {
    const r = encodeBase64('Ma')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('TWE=')
  })

  it('encodes "M" (produces 2 padding chars)', () => {
    const r = encodeBase64('M')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('TQ==')
  })

  it('handles accented/Latin characters (multi-byte UTF-8)', () => {
    const r = encodeBase64('café')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Decode back and check round-trip
    const d = decodeBase64(r.output, 'standard')
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.output).toBe('café')
  })

  it('handles emoji (4-byte UTF-8 code points)', () => {
    const r = encodeBase64('😀🎉')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = decodeBase64(r.output, 'standard')
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.output).toBe('😀🎉')
  })

  it('handles Japanese text', () => {
    const r = encodeBase64('日本語テスト')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = decodeBase64(r.output, 'standard')
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.output).toBe('日本語テスト')
  })

  it('produces output containing only valid standard Base64 chars', () => {
    const r = encodeBase64('any text here 🤖')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(/^[A-Za-z0-9+/=]+$/.test(r.output)).toBe(true)
  })
})

describe('encodeBase64 — url variant', () => {
  it('replaces + with - and / with _', () => {
    // ">" encodes to "Pg==" in standard; ">" → "Pg" in url
    const r = encodeBase64('>', 'url')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).not.toContain('+')
    expect(r.output).not.toContain('/')
    expect(r.output).not.toContain('=')
  })

  it('strips padding', () => {
    const r = encodeBase64('M', 'url')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('TQ')  // no ==
  })

  it('round-trips through URL variant', () => {
    const input = 'Hello, World! 🌍'
    const encoded = encodeBase64(input, 'url')
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const decoded = decodeBase64(encoded.output, 'url')
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.output).toBe(input)
  })

  it('produces output containing only valid Base64URL chars', () => {
    const r = encodeBase64('test data with emoji 🎯', 'url')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(/^[A-Za-z0-9\-_]*$/.test(r.output)).toBe(true)
  })
})

// ── decodeBase64 ──────────────────────────────────────────────────────────────

describe('decodeBase64 — standard variant', () => {
  it('decodes "aGVsbG8=" to "hello"', () => {
    const r = decodeBase64('aGVsbG8=')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('hello')
  })

  it('validates that a string without required padding is rejected', () => {
    // "hello" encodes to "aGVsbG8=" (8 chars). Stripping the = gives 7 chars.
    // 7 % 4 === 3, so our validator should reject it with a length error.
    const err = validateBase64('aGVsbG8', 'standard')
    expect(err).not.toBeNull()
    expect(err!.toLowerCase()).toContain('length')
  })

  it('decodes "TWFu" to "Man"', () => {
    const r = decodeBase64('TWFu')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('Man')
  })

  it('strips whitespace from input before decoding', () => {
    // Line-wrapped Base64 is a common format
    const r = decodeBase64('aGVs\nbG8=')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('hello')
  })

  it('strips spaces from input', () => {
    const r = decodeBase64('aGVs bG8=')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('hello')
  })

  it('decodes multi-byte UTF-8 (accented chars)', () => {
    const encoded = encodeBase64('café résumé').ok ? (encodeBase64('café résumé') as { ok: true; output: string }).output : ''
    const r = decodeBase64(encoded)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('café résumé')
  })

  it('decodes emoji correctly', () => {
    const encoded = (encodeBase64('🚀🌟💫') as { ok: true; output: string }).output
    const r = decodeBase64(encoded)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('🚀🌟💫')
  })

  it('returns error for empty input', () => {
    const r = decodeBase64('')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBeTruthy()
  })

  it('returns error for whitespace-only input', () => {
    const r = decodeBase64('   \n\t  ')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBeTruthy()
  })

  it('returns friendly error for invalid character @', () => {
    const r = decodeBase64('aGVs@bG8=')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('@')
  })

  it('returns friendly error for invalid character !', () => {
    const r = decodeBase64('aGVs!bG8=')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('!')
  })

  it('returns friendly error for too many padding chars', () => {
    const r = decodeBase64('aGVsbG8===')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.toLowerCase()).toContain('padding')
  })

  it('returns friendly error for non-UTF-8 byte sequences', () => {
    // 0xFF is not valid UTF-8 as a standalone byte
    const r = decodeBase64('/w==')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.toLowerCase()).toContain('utf')
  })
})

describe('decodeBase64 — url variant', () => {
  it('decodes Base64URL with - and _', () => {
    // ">" in Base64URL is "Pg" (no padding)
    const r = decodeBase64('Pg', 'url')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('>')
  })

  it('decodes unpadded Base64URL', () => {
    // "TQ" is "M" in Base64URL (would be "TQ==" in standard)
    const r = decodeBase64('TQ', 'url')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('M')
  })

  it('returns error for + in Base64URL input', () => {
    const r = decodeBase64('aGVs+bG8', 'url')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('+')
  })

  it('returns error for / in Base64URL input', () => {
    const r = decodeBase64('aGVs/bG8', 'url')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('/')
  })

  it('round-trips Unicode through Base64URL', () => {
    const texts = ['Hello, World!', 'café', '日本語', '😀🎉🚀', 'André Ñoño']
    for (const text of texts) {
      const enc = encodeBase64(text, 'url')
      expect(enc.ok).toBe(true)
      if (!enc.ok) continue
      const dec = decodeBase64(enc.output, 'url')
      expect(dec.ok).toBe(true)
      if (!dec.ok) continue
      expect(dec.output).toBe(text)
    }
  })
})

// ── validateBase64 ────────────────────────────────────────────────────────────

describe('validateBase64', () => {
  it('returns null for valid standard Base64', () => {
    expect(validateBase64('aGVsbG8=', 'standard')).toBeNull()
    expect(validateBase64('TWFu', 'standard')).toBeNull()
    expect(validateBase64('TQ==', 'standard')).toBeNull()
  })

  it('returns null for valid Base64URL', () => {
    expect(validateBase64('aGVsbG8', 'url')).toBeNull()
    expect(validateBase64('TWFu', 'url')).toBeNull()
    expect(validateBase64('TQ', 'url')).toBeNull()
  })

  it('returns error for empty string', () => {
    expect(validateBase64('', 'standard')).toBeTruthy()
    expect(validateBase64('', 'url')).toBeTruthy()
  })

  it('returns error for invalid char in standard Base64', () => {
    const err = validateBase64('aGVs@', 'standard')
    expect(err).not.toBeNull()
    expect(err).toContain('@')
  })

  it('returns error for invalid char in Base64URL', () => {
    const err = validateBase64('aGVs+', 'url')
    expect(err).not.toBeNull()
    expect(err).toContain('+')
  })

  it('returns error for too many padding chars', () => {
    const err = validateBase64('aGVsbG8===', 'standard')
    expect(err).not.toBeNull()
    expect(err!.toLowerCase()).toContain('padding')
  })
})

// ── bytesToDataUri ────────────────────────────────────────────────────────────

describe('bytesToDataUri', () => {
  it('builds a data URI with the given MIME type', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
    const uri = bytesToDataUri(bytes, 'text/plain')
    expect(uri).toBe('data:text/plain;base64,SGVsbG8=')
  })

  it('produces a valid data URI prefix', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]) // JPEG magic bytes
    const uri = bytesToDataUri(bytes, 'image/jpeg')
    expect(uri.startsWith('data:image/jpeg;base64,')).toBe(true)
  })

  it('handles empty byte array', () => {
    const uri = bytesToDataUri(new Uint8Array(0), 'application/octet-stream')
    expect(uri).toBe('data:application/octet-stream;base64,')
  })
})

// ── formatFileSize ────────────────────────────────────────────────────────────

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(1024 * 1024 - 1)).toContain('KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB')
  })
})

// ── estimateBase64Size ────────────────────────────────────────────────────────

describe('estimateBase64Size', () => {
  it('returns 0 for 0 bytes', () => {
    expect(estimateBase64Size(0)).toBe(0)
  })

  it('returns 4 for 1–3 bytes', () => {
    expect(estimateBase64Size(1)).toBe(4)
    expect(estimateBase64Size(2)).toBe(4)
    expect(estimateBase64Size(3)).toBe(4)
  })

  it('returns 8 for 4–6 bytes', () => {
    expect(estimateBase64Size(4)).toBe(8)
    expect(estimateBase64Size(6)).toBe(8)
  })

  it('matches actual btoa output length for ASCII', () => {
    const input = 'Hello World'
    const b64 = btoa(input) // ASCII only so btoa is fine here
    expect(estimateBase64Size(input.length)).toBe(b64.length)
  })
})
