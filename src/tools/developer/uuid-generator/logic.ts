/**
 * UUID / ULID Generator — pure logic (no React, no side-effects)
 *
 * Implements:
 *  - UUID v4  (RFC 9562 §5.4) — random, version/variant bits set
 *  - UUID v7  (RFC 9562 §5.7) — Unix ms timestamp + random, monotonic
 *  - ULID     (spec: github.com/ulid/spec) — 48-bit ms timestamp + 80-bit random, Crockford base32
 *  - Nano ID  (configurable alphabet/length, default 21 chars from URL-safe alphabet)
 *
 * All generators accept an injectable random source (and timestamp for v7/ULID)
 * so tests can be deterministic.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type IdType = 'uuidv4' | 'uuidv7' | 'ulid' | 'nanoid'

export interface UuidFormatOptions {
  /** 'upper' = uppercase hex letters; 'lower' = lowercase */
  casing: 'lower' | 'upper'
  /** Whether to include hyphens in UUID output */
  hyphens: boolean
}

/** Dependency-injectable random bytes source */
export type RandomSource = (byteCount: number) => Uint8Array

// ── Default random source (crypto.getRandomValues) ───────────────────────────

export function defaultRandom(byteCount: number): Uint8Array {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return bytes
}

// ── Hex helpers ───────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

// ── UUID v4 (RFC 9562 §5.4) ───────────────────────────────────────────────────

/**
 * Generate a UUID v4 string.
 *
 * Layout (128 bits):
 *   xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 *   where 4 = version nibble, y = variant nibble (10xx binary → 8,9,a,b)
 *
 * @param random  Injectable random source (defaults to crypto.getRandomValues)
 * @param options Formatting options (casing, hyphens)
 */
export function generateUuidV4(
  random: RandomSource = defaultRandom,
  options: UuidFormatOptions = { casing: 'lower', hyphens: true },
): string {
  const bytes = random(16)

  // Set version bits: version = 4 → byte 6 high nibble = 0100
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  // Set variant bits: variant = 10xx → byte 8 top two bits = 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  return formatUuidBytes(bytes, options)
}

/**
 * Format 16 raw UUID bytes into a string, applying casing and hyphen options.
 */
export function formatUuidBytes(bytes: Uint8Array, options: UuidFormatOptions): string {
  const hex = bytesToHex(bytes)
  // UUID canonical groups: 8-4-4-4-12
  const str = options.hyphens
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : hex

  return options.casing === 'upper' ? str.toUpperCase() : str
}

// ── UUID v7 (RFC 9562 §5.7) ───────────────────────────────────────────────────

/**
 * Generate a UUID v7 string.
 *
 * Layout (128 bits, big-endian):
 *   Bits  0–47  : Unix timestamp in milliseconds (48 bits)
 *   Bits 48–51  : version = 0b0111 (4 bits)
 *   Bits 52–63  : rand_a (12 random bits)
 *   Bits 64–65  : variant = 0b10 (2 bits)
 *   Bits 66–127 : rand_b (62 random bits)
 *
 * @param nowMs   Injectable current time in milliseconds (defaults to Date.now())
 * @param random  Injectable random source
 * @param options Formatting options
 */
export function generateUuidV7(
  nowMs: number = Date.now(),
  random: RandomSource = defaultRandom,
  options: UuidFormatOptions = { casing: 'lower', hyphens: true },
): string {
  const bytes = new Uint8Array(16)
  const rand = random(10) // 10 random bytes for rand_a + rand_b

  // Encode 48-bit timestamp into bytes 0–5
  // We use BigInt to avoid 32-bit integer overflow
  const ts = BigInt(nowMs)
  bytes[0] = Number((ts >> 40n) & 0xffn)
  bytes[1] = Number((ts >> 32n) & 0xffn)
  bytes[2] = Number((ts >> 24n) & 0xffn)
  bytes[3] = Number((ts >> 16n) & 0xffn)
  bytes[4] = Number((ts >> 8n) & 0xffn)
  bytes[5] = Number(ts & 0xffn)

  // Bytes 6–7: version nibble (4 bits) + rand_a (12 bits)
  bytes[6] = 0x70 | (rand[0] & 0x0f) // version = 7, top 4 bits of rand_a
  bytes[7] = rand[1]                   // low 8 bits of rand_a

  // Byte 8: variant (2 bits = 10) + high 6 bits of rand_b
  bytes[8] = 0x80 | (rand[2] & 0x3f)
  // Bytes 9–15: remaining rand_b (56 bits)
  bytes[9] = rand[3]
  bytes[10] = rand[4]
  bytes[11] = rand[5]
  bytes[12] = rand[6]
  bytes[13] = rand[7]
  bytes[14] = rand[8]
  bytes[15] = rand[9]

  return formatUuidBytes(bytes, options)
}

/**
 * Extract the Unix timestamp (ms) from a UUID v7 hex string (with or without hyphens).
 * Returns null if the string is not a valid UUID v7.
 */
export function extractUuidV7Timestamp(uuid: string): number | null {
  const hex = uuid.replace(/-/g, '')
  if (hex.length !== 32) return null
  // Version nibble must be 7
  if (hex[12] !== '7') return null
  // Bytes 0–5 = top 48 bits = ms timestamp
  const tsHex = hex.slice(0, 12)
  return parseInt(tsHex, 16)
}

// ── ULID ──────────────────────────────────────────────────────────────────────

/**
 * Crockford base32 alphabet (uppercase, no I, L, O, U).
 * Index = value (0–31).
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Generate a ULID string (26 Crockford base32 characters).
 *
 * Layout:
 *   chars 0–9  : 48-bit Unix ms timestamp encoded in 10 Crockford base32 chars
 *                (each char = 5 bits; 10 × 5 = 50 bits used; top 2 bits always 0 since
 *                 max timestamp ≈ 281 trillion — well within 48-bit range)
 *   chars 10–25: 80 random bits encoded in 16 Crockford base32 chars
 *
 * @param nowMs   Injectable current time in milliseconds
 * @param random  Injectable random source (needs 10 bytes = 80 bits)
 */
export function generateUlid(
  nowMs: number = Date.now(),
  random: RandomSource = defaultRandom,
): string {
  // Encode 48-bit timestamp into 10 base32 chars
  // We treat timestamp as a 50-bit value (10 × 5 bits), padding top with 0s
  const tsChars = encodeBase32Ulid(nowMs, 10)

  // Encode 80 random bits into 16 base32 chars
  const randBytes = random(10) // 10 bytes = 80 bits
  const randChars = encodeRandomBase32(randBytes, 16)

  return tsChars + randChars
}

/**
 * Encode an integer value into `length` Crockford base32 characters (big-endian).
 */
function encodeBase32Ulid(value: number, length: number): string {
  let result = ''
  // Build characters from least-significant to most-significant, then reverse
  let v = value
  for (let i = 0; i < length; i++) {
    result = CROCKFORD_ALPHABET[v & 0x1f] + result
    v = Math.floor(v / 32)
  }
  return result
}

/**
 * Encode raw bytes into Crockford base32 characters.
 * Processes the bytes as a bit stream, extracting 5-bit groups from left to right.
 *
 * @param bytes    Source bytes
 * @param charCount Number of base32 characters to emit (must be ≤ bytes.length * 8 / 5 + 1)
 */
function encodeRandomBase32(bytes: Uint8Array, charCount: number): string {
  let result = ''
  let bitBuffer = 0
  let bitsInBuffer = 0
  let byteIndex = 0

  for (let i = 0; i < charCount; i++) {
    // Fill buffer until we have at least 5 bits
    while (bitsInBuffer < 5 && byteIndex < bytes.length) {
      bitBuffer = (bitBuffer << 8) | bytes[byteIndex++]
      bitsInBuffer += 8
    }
    // Extract top 5 bits
    const shift = bitsInBuffer - 5
    const index = (bitBuffer >> shift) & 0x1f
    result += CROCKFORD_ALPHABET[index]
    bitsInBuffer -= 5
  }

  return result
}

/**
 * Extract the Unix timestamp (ms) from a ULID string.
 * Returns null if the string is not a 26-char valid ULID.
 */
export function extractUlidTimestamp(ulid: string): number | null {
  if (ulid.length !== 26) return null
  const tsChars = ulid.slice(0, 10).toUpperCase()

  // Decode Crockford base32
  let value = 0
  for (const ch of tsChars) {
    const idx = CROCKFORD_ALPHABET.indexOf(ch)
    if (idx === -1) return null
    value = value * 32 + idx
  }
  return value
}

// ── Nano ID ───────────────────────────────────────────────────────────────────

/**
 * Default Nano ID alphabet — URL-safe (A-Z a-z 0-9 _ -).
 * 64 characters, chosen to be power-of-2 for unbiased rejection sampling.
 */
export const NANOID_DEFAULT_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

export const NANOID_MIN_LENGTH = 2
export const NANOID_MAX_LENGTH = 64

/**
 * Generate a Nano ID string.
 *
 * Uses rejection sampling (mask + retry) to eliminate modulo bias.
 * Alphabet length must be 1–256; length must be 2–64.
 *
 * @param length   Length of the output string (default 21)
 * @param alphabet Characters to sample from (default URL-safe 64-char set)
 * @param random   Injectable random source
 */
export function generateNanoId(
  length = 21,
  alphabet: string = NANOID_DEFAULT_ALPHABET,
  random: RandomSource = defaultRandom,
): string {
  if (length < NANOID_MIN_LENGTH || length > NANOID_MAX_LENGTH) {
    throw new RangeError(
      `Nano ID length must be between ${NANOID_MIN_LENGTH} and ${NANOID_MAX_LENGTH}`,
    )
  }
  if (alphabet.length === 0 || alphabet.length > 256) {
    throw new RangeError('Alphabet must be 1–256 characters long')
  }

  const alphabetSize = alphabet.length
  // Compute the smallest power-of-2 mask ≥ alphabetSize
  const mask = (2 << (31 - Math.clz32(alphabetSize - 1 || 1))) - 1
  // Over-generate to reduce retry probability
  const step = Math.ceil((1.6 * mask * length) / alphabetSize)

  let result = ''
  while (result.length < length) {
    const bytes = random(step)
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      const idx = bytes[i] & mask
      if (idx < alphabetSize) {
        result += alphabet[idx]
      }
    }
  }
  return result
}

// ── Bulk generation ───────────────────────────────────────────────────────────

export const MIN_COUNT = 1
export const MAX_COUNT = 1000

/**
 * Generate `count` identifiers of the given type.
 * UUID v7 IDs use monotonically increasing timestamps: if two IDs land in the
 * same millisecond the timestamp is artificially incremented to guarantee
 * lexicographic ordering within a batch.
 */
export function generateBulk(
  type: IdType,
  count: number,
  options: UuidFormatOptions,
  nanoIdLength: number,
  random: RandomSource = defaultRandom,
): string[] {
  const clampedCount = Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round(count)))
  const results: string[] = []

  if (type === 'uuidv7') {
    // Monotonic: each id gets a timestamp ≥ the previous one
    let lastMs = Date.now()
    for (let i = 0; i < clampedCount; i++) {
      const nowMs = Date.now()
      if (nowMs > lastMs) lastMs = nowMs
      else lastMs++ // bump to guarantee ordering within a burst
      results.push(generateUuidV7(lastMs, random, options))
    }
  } else if (type === 'uuidv4') {
    for (let i = 0; i < clampedCount; i++) {
      results.push(generateUuidV4(random, options))
    }
  } else if (type === 'ulid') {
    let lastMs = Date.now()
    for (let i = 0; i < clampedCount; i++) {
      const nowMs = Date.now()
      if (nowMs > lastMs) lastMs = nowMs
      else lastMs++
      results.push(generateUlid(lastMs, random))
    }
  } else {
    // nanoid
    for (let i = 0; i < clampedCount; i++) {
      results.push(generateNanoId(nanoIdLength, NANOID_DEFAULT_ALPHABET, random))
    }
  }

  return results
}
