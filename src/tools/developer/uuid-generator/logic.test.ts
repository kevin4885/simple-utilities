import { describe, it, expect } from 'vitest'
import {
  generateUuidV4,
  generateUuidV7,
  generateUlid,
  generateNanoId,
  generateBulk,
  extractUuidV7Timestamp,
  extractUlidTimestamp,
  formatUuidBytes,
  CROCKFORD_ALPHABET,
  NANOID_DEFAULT_ALPHABET,
  NANOID_MIN_LENGTH,
  NANOID_MAX_LENGTH,
} from './logic'
import type { UuidFormatOptions, RandomSource } from './logic'

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Fixed random source — returns a repeating byte pattern */
function fixedRandom(pattern: number[]): RandomSource {
  return (byteCount: number) => {
    const bytes = new Uint8Array(byteCount)
    for (let i = 0; i < byteCount; i++) {
      bytes[i] = pattern[i % pattern.length]
    }
    return bytes
  }
}

/** Counter-based random source — each call returns incrementing bytes */
function counterRandom(): RandomSource {
  let counter = 0
  return (byteCount: number) => {
    const bytes = new Uint8Array(byteCount)
    for (let i = 0; i < byteCount; i++) {
      bytes[i] = counter++ & 0xff
    }
    return bytes
  }
}

const defaultOptions: UuidFormatOptions = { casing: 'lower', hyphens: true }
const upperNoHyphens: UuidFormatOptions = { casing: 'upper', hyphens: false }

// ── UUID v4 ───────────────────────────────────────────────────────────────────

describe('generateUuidV4', () => {
  it('produces a string of correct length with hyphens', () => {
    const id = generateUuidV4(fixedRandom([0xab]), defaultOptions)
    expect(id).toHaveLength(36)
  })

  it('produces correct hyphen positions', () => {
    const id = generateUuidV4(fixedRandom([0x12]), defaultOptions)
    expect(id[8]).toBe('-')
    expect(id[13]).toBe('-')
    expect(id[18]).toBe('-')
    expect(id[23]).toBe('-')
  })

  it('produces a 32-char string without hyphens', () => {
    const id = generateUuidV4(fixedRandom([0xab]), { casing: 'lower', hyphens: false })
    expect(id).toHaveLength(32)
    expect(id).not.toContain('-')
  })

  it('version nibble is 4', () => {
    // Char at position 14 (after removing hyphens it's index 12) must be '4'
    const id = generateUuidV4(fixedRandom([0xff]), defaultOptions)
    expect(id[14]).toBe('4')
  })

  it('variant nibble is 8, 9, a, or b', () => {
    // Char at position 19 (after removing hyphens: index 16) must be 8/9/a/b
    for (let i = 0; i < 50; i++) {
      const id = generateUuidV4(undefined, defaultOptions)
      expect(['8', '9', 'a', 'b']).toContain(id[19])
    }
  })

  it('outputs lowercase by default', () => {
    const id = generateUuidV4(fixedRandom([0xab]), defaultOptions)
    expect(id).toBe(id.toLowerCase())
  })

  it('outputs uppercase when requested', () => {
    const id = generateUuidV4(fixedRandom([0xab]), upperNoHyphens)
    expect(id).toBe(id.toUpperCase())
  })

  it('matches the RFC 9562 version/variant bit pattern with fixed random input', () => {
    // With all 0xFF bytes: byte 6 & 0x0f | 0x40 = 0x4f, byte 8 & 0x3f | 0x80 = 0xbf
    const id = generateUuidV4(fixedRandom([0xff]), defaultOptions)
    const hex = id.replace(/-/g, '')
    expect(hex.slice(12, 13)).toBe('4') // version nibble
    const variantNibble = parseInt(hex.slice(16, 17), 16)
    // Variant 10xx → nibble value 8-11 (0x8-0xb)
    expect(variantNibble).toBeGreaterThanOrEqual(8)
    expect(variantNibble).toBeLessThanOrEqual(11)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUuidV4()))
    expect(ids.size).toBe(100)
  })

  it('contains only valid hex and hyphen characters (lowercase)', () => {
    const id = generateUuidV4(undefined, defaultOptions)
    expect(/^[0-9a-f-]+$/.test(id)).toBe(true)
  })
})

// ── UUID v7 ───────────────────────────────────────────────────────────────────

describe('generateUuidV7', () => {
  it('produces a 36-char string with hyphens', () => {
    const id = generateUuidV7(Date.now(), fixedRandom([0x55]), defaultOptions)
    expect(id).toHaveLength(36)
  })

  it('version nibble is 7', () => {
    const id = generateUuidV7(Date.now(), fixedRandom([0x55]), defaultOptions)
    expect(id[14]).toBe('7')
  })

  it('variant nibble is 8, 9, a, or b', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateUuidV7(Date.now(), undefined, defaultOptions)
      expect(['8', '9', 'a', 'b']).toContain(id[19])
    }
  })

  it('encodes the timestamp correctly (recoverable via extractUuidV7Timestamp)', () => {
    const ts = 1_700_000_000_000 // Nov 14 2023
    const id = generateUuidV7(ts, fixedRandom([0x00]), defaultOptions)
    expect(extractUuidV7Timestamp(id)).toBe(ts)
  })

  it('two v7 IDs with increasing timestamps sort lexicographically', () => {
    const rand = fixedRandom([0x55])
    const id1 = generateUuidV7(1_000_000_000, rand, defaultOptions)
    const id2 = generateUuidV7(1_000_000_001, rand, defaultOptions)
    // Remove hyphens for pure hex comparison
    const h1 = id1.replace(/-/g, '')
    const h2 = id2.replace(/-/g, '')
    expect(h1 < h2).toBe(true)
  })

  it('IDs from a burst batch are in ascending order (monotonic)', () => {
    const ids = generateBulk('uuidv7', 50, defaultOptions, 21)
    for (let i = 1; i < ids.length; i++) {
      const prev = ids[i - 1].replace(/-/g, '')
      const curr = ids[i].replace(/-/g, '')
      expect(prev <= curr).toBe(true)
    }
  })

  it('extractUuidV7Timestamp returns null for non-v7 UUID', () => {
    const v4 = generateUuidV4(undefined, defaultOptions)
    expect(extractUuidV7Timestamp(v4)).toBeNull()
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUuidV7()))
    expect(ids.size).toBe(100)
  })
})

// ── ULID ──────────────────────────────────────────────────────────────────────

describe('generateUlid', () => {
  it('produces a 26-character string', () => {
    const id = generateUlid(Date.now(), fixedRandom([0xaa]))
    expect(id).toHaveLength(26)
  })

  it('contains only Crockford base32 characters (uppercase)', () => {
    const validChars = new Set(CROCKFORD_ALPHABET)
    const id = generateUlid(Date.now(), fixedRandom([0xbb]))
    for (const ch of id) {
      expect(validChars.has(ch)).toBe(true)
    }
  })

  it('timestamp prefix encodes the given ms timestamp correctly', () => {
    const ts = 1_700_000_000_000
    const id = generateUlid(ts, fixedRandom([0x00]))
    expect(extractUlidTimestamp(id)).toBe(ts)
  })

  it('two ULIDs with increasing timestamps sort correctly', () => {
    const rand = fixedRandom([0x55])
    const id1 = generateUlid(1_000_000_000, rand)
    const id2 = generateUlid(1_000_000_001, rand)
    expect(id1 < id2).toBe(true)
  })

  it('ULID batch is in ascending order (monotonic)', () => {
    const ids = generateBulk('ulid', 50, defaultOptions, 21)
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i - 1] <= ids[i]).toBe(true)
    }
  })

  it('does not contain I, L, O, or U (excluded from Crockford alphabet)', () => {
    const excluded = new Set(['I', 'L', 'O', 'U'])
    for (let i = 0; i < 50; i++) {
      const id = generateUlid()
      for (const ch of id) {
        expect(excluded.has(ch)).toBe(false)
      }
    }
  })

  it('extractUlidTimestamp returns null for wrong-length string', () => {
    expect(extractUlidTimestamp('SHORT')).toBeNull()
    expect(extractUlidTimestamp('A'.repeat(25))).toBeNull()
    expect(extractUlidTimestamp('A'.repeat(27))).toBeNull()
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUlid()))
    expect(ids.size).toBe(100)
  })
})

// ── Nano ID ───────────────────────────────────────────────────────────────────

describe('generateNanoId', () => {
  it('produces default length of 21', () => {
    const id = generateNanoId(21, NANOID_DEFAULT_ALPHABET, fixedRandom([0x10]))
    expect(id).toHaveLength(21)
  })

  it('produces the requested length', () => {
    for (const len of [2, 10, 21, 36, 64]) {
      const id = generateNanoId(len, NANOID_DEFAULT_ALPHABET, fixedRandom([0x33]))
      expect(id).toHaveLength(len)
    }
  })

  it('contains only default-alphabet characters', () => {
    const validChars = new Set(NANOID_DEFAULT_ALPHABET)
    for (let i = 0; i < 20; i++) {
      const id = generateNanoId(21)
      for (const ch of id) {
        expect(validChars.has(ch)).toBe(true)
      }
    }
  })

  it('respects NANOID_MIN_LENGTH and NANOID_MAX_LENGTH constants', () => {
    expect(NANOID_MIN_LENGTH).toBe(2)
    expect(NANOID_MAX_LENGTH).toBe(64)
  })

  it('throws RangeError for length below minimum', () => {
    expect(() => generateNanoId(1)).toThrow(RangeError)
  })

  it('throws RangeError for length above maximum', () => {
    expect(() => generateNanoId(65)).toThrow(RangeError)
  })

  it('throws RangeError for empty alphabet', () => {
    expect(() => generateNanoId(10, '')).toThrow(RangeError)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateNanoId()))
    expect(ids.size).toBe(100)
  })

  it('default alphabet is 64 chars and URL-safe', () => {
    expect(NANOID_DEFAULT_ALPHABET).toHaveLength(64)
    expect(/^[A-Za-z0-9_-]+$/.test(NANOID_DEFAULT_ALPHABET)).toBe(true)
  })

  it('rejection sampling with non-power-of-2 alphabet produces unbiased output (all chars appear)', () => {
    // Alphabet of size 3: mask = 3 (next power-of-2 – 1), so idx 3 is rejected.
    // This exercises the rejection branch in the generator.
    const alphabet = 'abc'
    const ids = Array.from({ length: 200 }, () => generateNanoId(21, alphabet))
    // All chars must appear (statistical guarantee with 200×21 = 4200 samples)
    const seen = new Set(ids.join(''))
    expect(seen.has('a')).toBe(true)
    expect(seen.has('b')).toBe(true)
    expect(seen.has('c')).toBe(true)
    // Only alphabet chars should appear
    for (const id of ids) {
      expect(/^[abc]+$/.test(id)).toBe(true)
      expect(id).toHaveLength(21)
    }
  })
})

// ── formatUuidBytes ───────────────────────────────────────────────────────────

describe('formatUuidBytes', () => {
  const allZeroBytes = new Uint8Array(16)

  it('formats with hyphens lowercase', () => {
    const result = formatUuidBytes(allZeroBytes, { casing: 'lower', hyphens: true })
    expect(result).toBe('00000000-0000-0000-0000-000000000000')
  })

  it('formats without hyphens lowercase', () => {
    const result = formatUuidBytes(allZeroBytes, { casing: 'lower', hyphens: false })
    expect(result).toBe('0'.repeat(32))
  })

  it('formats with hyphens uppercase', () => {
    const bytes = new Uint8Array(16).fill(0xab)
    const result = formatUuidBytes(bytes, { casing: 'upper', hyphens: true })
    expect(result).toBe('ABABABAB-ABAB-ABAB-ABAB-ABABABABABAB')
  })

  it('formats without hyphens uppercase', () => {
    const bytes = new Uint8Array(16).fill(0xcd)
    const result = formatUuidBytes(bytes, { casing: 'upper', hyphens: false })
    expect(result).toBe('CDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCD')
  })
})

// ── generateBulk ──────────────────────────────────────────────────────────────

describe('generateBulk', () => {
  it('generates the requested count of UUIDs v4', () => {
    const ids = generateBulk('uuidv4', 10, defaultOptions, 21)
    expect(ids).toHaveLength(10)
  })

  it('generates the requested count of UUIDs v7', () => {
    const ids = generateBulk('uuidv7', 10, defaultOptions, 21)
    expect(ids).toHaveLength(10)
  })

  it('generates the requested count of ULIDs', () => {
    const ids = generateBulk('ulid', 10, defaultOptions, 21)
    expect(ids).toHaveLength(10)
  })

  it('generates the requested count of Nano IDs', () => {
    const ids = generateBulk('nanoid', 10, defaultOptions, 21)
    expect(ids).toHaveLength(10)
    for (const id of ids) {
      expect(id).toHaveLength(21)
    }
  })

  it('clamps count to MAX_COUNT (1000)', () => {
    const ids = generateBulk('uuidv4', 1001, defaultOptions, 21)
    expect(ids).toHaveLength(1000)
  })

  it('clamps count to MIN_COUNT (1)', () => {
    const ids = generateBulk('uuidv4', 0, defaultOptions, 21)
    expect(ids).toHaveLength(1)
  })

  it('v7 bulk IDs are monotonically non-decreasing', () => {
    const ids = generateBulk('uuidv7', 100, defaultOptions, 21)
    for (let i = 1; i < ids.length; i++) {
      const prev = ids[i - 1].replace(/-/g, '')
      const curr = ids[i].replace(/-/g, '')
      expect(prev <= curr).toBe(true)
    }
  })

  it('applies casing and hyphens options to UUID types', () => {
    const ids = generateBulk('uuidv4', 5, upperNoHyphens, 21)
    for (const id of ids) {
      expect(id).toHaveLength(32)
      expect(/^[0-9A-F]+$/.test(id)).toBe(true)
    }
  })

  it('nanoid length respects the nanoIdLength parameter', () => {
    const ids = generateBulk('nanoid', 5, defaultOptions, 16)
    for (const id of ids) {
      expect(id).toHaveLength(16)
    }
  })

  it('uses a counter-based random for reproducible output', () => {
    const rand = counterRandom()
    const ids1 = generateBulk('uuidv4', 3, defaultOptions, 21, rand)
    const rand2 = counterRandom()
    const ids2 = generateBulk('uuidv4', 3, defaultOptions, 21, rand2)
    expect(ids1).toEqual(ids2)
  })
})
