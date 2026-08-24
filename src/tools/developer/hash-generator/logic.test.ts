/**
 * Hash Generator — logic unit tests
 *
 * Tests:
 *  - MD5 against all RFC 1321 test vectors
 *  - SHA-256 known vectors (if crypto.subtle available in env)
 *  - HMAC-SHA-256 known vector
 *  - bytesToHex (lower/upper)
 *  - hexToBase64
 *  - formatDigest (all combinations)
 *  - encodeUtf8 (ASCII + Unicode)
 *  - formatFileSize
 */

import { describe, it, expect } from 'vitest'
import {
  md5,
  sha256,
  sha512,
  hmacSha256,
  encodeUtf8,
  bytesToHex,
  hexToBase64,
  formatDigest,
  formatFileSize,
  computeAllHashes,
} from './logic'

// ── Helpers ───────────────────────────────────────────────────────────────────

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

// ── MD5 — RFC 1321 test vectors (Appendix A.5) ────────────────────────────────

describe('md5 — RFC 1321 test vectors', () => {
  it('empty string ""', () => {
    expect(md5(utf8Bytes(''))).toBe('d41d8cd98f00b204e9800998ecf8427e')
  })

  it('"a"', () => {
    expect(md5(utf8Bytes('a'))).toBe('0cc175b9c0f1b6a831c399e269772661')
  })

  it('"abc"', () => {
    expect(md5(utf8Bytes('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72')
  })

  it('"message digest"', () => {
    expect(md5(utf8Bytes('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0')
  })

  it('"abcdefghijklmnopqrstuvwxyz"', () => {
    expect(md5(utf8Bytes('abcdefghijklmnopqrstuvwxyz'))).toBe(
      'c3fcd3d76192e4007dfb496cca67e13b',
    )
  })

  it('"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"', () => {
    expect(
      md5(utf8Bytes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')),
    ).toBe('d174ab98d277d9f5a5611c2c9f419d9f')
  })

  it('"12345678901234567890..." (80 chars, RFC 1321 last vector)', () => {
    expect(
      md5(utf8Bytes('12345678901234567890123456789012345678901234567890123456789012345678901234567890')),
    ).toBe('57edf4a22be3c955ac49da2e2107b67a')
  })

  it('produces a 32-character lowercase hex string', () => {
    const digest = md5(utf8Bytes('test'))
    expect(digest).toHaveLength(32)
    expect(/^[0-9a-f]+$/.test(digest)).toBe(true)
  })

  it('handles multi-byte UTF-8 input (café)', () => {
    // UTF-8 of "café" = 63 61 66 c3 a9 (5 bytes, not 4)
    const digest = md5(utf8Bytes('café'))
    expect(digest).toHaveLength(32)
    expect(/^[0-9a-f]+$/.test(digest)).toBe(true)
    // Must differ from ASCII "cafe"
    expect(digest).not.toBe(md5(utf8Bytes('cafe')))
  })

  it('handles emoji (4-byte UTF-8)', () => {
    const digest = md5(utf8Bytes('😀'))
    expect(digest).toHaveLength(32)
    expect(/^[0-9a-f]+$/.test(digest)).toBe(true)
  })

  it('handles a 1 MB input without errors', () => {
    const bigInput = new Uint8Array(1024 * 1024).fill(0x61) // 1 MB of 'a'
    const digest = md5(bigInput)
    expect(digest).toHaveLength(32)
  })

  it('binary bytes spanning multiple 512-bit blocks', () => {
    // 128 bytes (exactly 2 blocks before padding) — just tests no crash
    const input = new Uint8Array(128)
    for (let i = 0; i < 128; i++) input[i] = i & 0xff
    const digest = md5(input)
    expect(digest).toHaveLength(32)
  })
})

// ── SHA-256 — NIST test vectors ───────────────────────────────────────────────
// crypto.subtle is available in Node ≥ 20 and all modern jsdom environments.

describe('sha256 — known test vectors', () => {
  it('empty string', async () => {
    const digest = await sha256(utf8Bytes(''))
    expect(digest).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('"abc"', async () => {
    const digest = await sha256(utf8Bytes('abc'))
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('"hello world"', async () => {
    const digest = await sha256(utf8Bytes('hello world'))
    expect(digest).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  })

  it('"hello"', async () => {
    const digest = await sha256(utf8Bytes('hello'))
    expect(digest).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('produces 64-char lowercase hex', async () => {
    const digest = await sha256(utf8Bytes('test'))
    expect(digest).toHaveLength(64)
    expect(/^[0-9a-f]+$/.test(digest)).toBe(true)
  })
})

// ── SHA-512 — NIST test vector ────────────────────────────────────────────────

describe('sha512 — NIST test vectors', () => {
  it('empty string', async () => {
    const digest = await sha512(utf8Bytes(''))
    expect(digest).toBe(
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    )
  })

  it('produces 128-char lowercase hex', async () => {
    const digest = await sha512(utf8Bytes('test'))
    expect(digest).toHaveLength(128)
  })
})

// ── HMAC-SHA-256 — RFC 4231 test vector ──────────────────────────────────────

describe('hmacSha256 — RFC 4231 test vector', () => {
  it('Test Case 1: key=0x0b×20, data="Hi There"', async () => {
    const key = new Uint8Array(20).fill(0x0b)
    const data = utf8Bytes('Hi There')
    const digest = await hmacSha256(key, data)
    expect(digest).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
  })

  it('Test Case 2: key="Jefe", data="what do ya want for nothing?"', async () => {
    const key = utf8Bytes('Jefe')
    const data = utf8Bytes('what do ya want for nothing?')
    const digest = await hmacSha256(key, data)
    expect(digest).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })

  it('produces 64-char lowercase hex', async () => {
    const key = utf8Bytes('key')
    const data = utf8Bytes('data')
    const digest = await hmacSha256(key, data)
    expect(digest).toHaveLength(64)
    expect(/^[0-9a-f]+$/.test(digest)).toBe(true)
  })
})

// ── bytesToHex ────────────────────────────────────────────────────────────────

describe('bytesToHex', () => {
  it('converts bytes to lowercase hex', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0xff, 0xab, 0x12]))).toBe('00ffab12')
  })

  it('converts bytes to uppercase hex', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0xff, 0xab, 0x12]), 'upper')).toBe('00FFAB12')
  })

  it('handles empty array', () => {
    expect(bytesToHex(new Uint8Array(0))).toBe('')
  })

  it('pads single nibble bytes with leading zero', () => {
    expect(bytesToHex(new Uint8Array([0x0f]))).toBe('0f')
    expect(bytesToHex(new Uint8Array([0x01]))).toBe('01')
  })
})

// ── hexToBase64 ───────────────────────────────────────────────────────────────

describe('hexToBase64', () => {
  it('converts "48656c6c6f" ("Hello") to Base64 "SGVsbG8="', () => {
    expect(hexToBase64('48656c6c6f')).toBe('SGVsbG8=')
  })

  it('converts empty hex to empty Base64', () => {
    expect(hexToBase64('')).toBe('')
  })

  it('is consistent with btoa for known value', () => {
    // "Man" = 0x4d 0x61 0x6e → Base64 "TWFu"
    expect(hexToBase64('4d616e')).toBe('TWFu')
  })

  it('converts MD5 of empty string to Base64', () => {
    const hex = 'd41d8cd98f00b204e9800998ecf8427e'
    const b64 = hexToBase64(hex)
    expect(b64).toBeTruthy()
    // Should be 24 chars (16 bytes → 24 base64 chars with padding)
    expect(b64).toHaveLength(24)
  })
})

// ── formatDigest ─────────────────────────────────────────────────────────────

describe('formatDigest', () => {
  const hexLower = 'deadbeef'

  it('hex + lower → unchanged', () => {
    expect(formatDigest(hexLower, 'lower', 'hex')).toBe('deadbeef')
  })

  it('hex + upper → uppercase', () => {
    expect(formatDigest(hexLower, 'upper', 'hex')).toBe('DEADBEEF')
  })

  it('base64 + lower → base64 (case param ignored for base64)', () => {
    const b64 = formatDigest(hexLower, 'lower', 'base64')
    // "deadbeef" = 0xde 0xad 0xbe 0xef → base64 "3q2+7w=="
    expect(b64).toBe('3q2+7w==')
  })

  it('base64 + upper → base64 (same as lower — encoding ignores hex case)', () => {
    expect(formatDigest(hexLower, 'lower', 'base64')).toBe(
      formatDigest(hexLower, 'upper', 'base64'),
    )
  })
})

// ── encodeUtf8 ────────────────────────────────────────────────────────────────

describe('encodeUtf8', () => {
  it('encodes ASCII string to bytes', () => {
    const bytes = encodeUtf8('abc')
    expect(Array.from(bytes)).toEqual([0x61, 0x62, 0x63])
  })

  it('encodes empty string to empty bytes', () => {
    expect(encodeUtf8('')).toHaveLength(0)
  })

  it('encodes "café" to 5 bytes (not 4) — é is 2-byte UTF-8', () => {
    const bytes = encodeUtf8('café')
    expect(bytes).toHaveLength(5) // c(1) + a(1) + f(1) + é(2)
    expect(bytes[3]).toBe(0xc3) // First byte of UTF-8 é
    expect(bytes[4]).toBe(0xa9) // Second byte of UTF-8 é
  })

  it('encodes emoji to 4 bytes', () => {
    const bytes = encodeUtf8('😀')
    expect(bytes).toHaveLength(4)
    expect(bytes[0]).toBe(0xf0)
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
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB')
  })
})

// ── computeAllHashes ─────────────────────────────────────────────────────────

describe('computeAllHashes', () => {
  it('returns all 5 algorithms for text input', async () => {
    const bytes = utf8Bytes('hello')
    const result = await computeAllHashes(bytes)
    expect(Object.keys(result)).toEqual(['md5', 'sha1', 'sha256', 'sha384', 'sha512'])
    // MD5 of "hello"
    expect(result.md5).toBe('5d41402abc4b2a76b9719d911017c592')
    // All digests are non-empty hex
    for (const [id, digest] of Object.entries(result)) {
      if (id === 'md5') continue // already checked
      expect(digest.length).toBeGreaterThan(0)
      expect(/^[0-9a-f]+$/.test(digest)).toBe(true)
    }
  })

  it('in HMAC mode, md5 is empty and SHA-* use HMAC', async () => {
    const key = utf8Bytes('secret')
    const data = utf8Bytes('message')
    const result = await computeAllHashes(data, key)
    expect(result.md5).toBe('') // HMAC-MD5 not supported
    expect(result.sha256).toHaveLength(64)
    // HMAC result must differ from plain SHA-256
    const plain = await computeAllHashes(data)
    expect(result.sha256).not.toBe(plain.sha256)
  })

  it('empty bytes produce known MD5', async () => {
    const result = await computeAllHashes(new Uint8Array(0))
    expect(result.md5).toBe('d41d8cd98f00b204e9800998ecf8427e')
  })
})
