/**
 * Hash Generator — pure logic (no React, no side-effects)
 *
 * Exports:
 *   md5               — MD5 digest of a Uint8Array → hex string (RFC 1321 clean-room)
 *   sha1              — SHA-1 via crypto.subtle
 *   sha256            — SHA-256 via crypto.subtle
 *   sha384            — SHA-384 via crypto.subtle
 *   sha512            — SHA-512 via crypto.subtle
 *   hmacSha256        — HMAC-SHA-256 via crypto.subtle
 *   hmacSha384        — HMAC-SHA-384 via crypto.subtle
 *   hmacSha512        — HMAC-SHA-512 via crypto.subtle
 *   encodeUtf8        — encode a string to UTF-8 bytes
 *   bytesToHex        — byte array → hex string (lower or upper)
 *   hexToBase64       — hex string → base64 string
 *   formatDigest      — apply case and encoding to a hex digest
 *   formatFileSize    — human-readable byte count
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Output case for hex digests. */
export type HexCase = 'lower' | 'upper'

/** Output encoding: hex or base64. */
export type OutputEncoding = 'hex' | 'base64'

/** All available hash algorithm IDs. */
export type HashAlgorithmId = 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512'

/** Algorithms that support HMAC (excludes MD5). */
export type HmacAlgorithmId = 'sha1' | 'sha256' | 'sha384' | 'sha512'

export interface HashResult {
  algorithmId: HashAlgorithmId
  label: string
  /** Digest in the requested encoding/case */
  digest: string
  /** Raw digest always as lowercase hex (for copy/export) */
  digestHex: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Encode a JavaScript string to UTF-8 bytes.
 */
export function encodeUtf8(input: string): Uint8Array {
  return new TextEncoder().encode(input)
}

/**
 * Convert a Uint8Array to a hex string (lowercase or uppercase).
 */
export function bytesToHex(bytes: Uint8Array, casing: HexCase = 'lower'): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return casing === 'upper' ? hex.toUpperCase() : hex
}

/**
 * Convert a hex string to a Base64 string.
 * The hex must have even length (pairs of nibbles).
 */
export function hexToBase64(hex: string): string {
  // hex → bytes → base64
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Apply case + encoding to a raw lowercase hex digest.
 * Returns the formatted string ready for display.
 */
export function formatDigest(hexDigest: string, casing: HexCase, encoding: OutputEncoding): string {
  if (encoding === 'base64') return hexToBase64(hexDigest)
  return casing === 'upper' ? hexDigest.toUpperCase() : hexDigest
}

/**
 * Format a byte count as a human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ── MD5 (RFC 1321 clean-room implementation) ──────────────────────────────────
//
// This is a standard clean-room MD5 derived directly from RFC 1321.
// The per-round constants T[i] = floor(2^32 * |sin(i)|) where i is 1-indexed.
// The shift amounts and auxiliary functions are also straight from RFC 1321.
//
// References:
//   - RFC 1321: The MD5 Message-Digest Algorithm (Rivest, 1992)

/** T[i] = floor(abs(sin(i+1)) * 2^32) for i = 0..63 (1-indexed in the spec). */
const MD5_T = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
])

/** Per-round left-rotate shift amounts (RFC 1321 §3.4). */
const MD5_S = new Uint8Array([
  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,
])

/** Left-rotate a 32-bit integer by n bits. */
function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0
}

/** Add two 32-bit integers (wrapping). */
function add32(a: number, b: number): number {
  return (a + b) >>> 0
}

/**
 * Compute the MD5 digest of arbitrary bytes.
 * Returns a 32-character lowercase hex string.
 */
export function md5(input: Uint8Array): string {
  // ── Step 1: pad to 512-bit (64-byte) blocks ────────────────────────────────
  // Append bit 1 (0x80 byte), then zero bytes, then 64-bit little-endian length.
  const msgLen = input.length
  // Final padded length: original + 0x80 byte + zero padding + 8-byte length
  // Must be ≡ 0 mod 64. The 0x80 byte and 8 length bytes account for 9 bytes.
  const paddedLen = (msgLen + 9 + 63) & ~63
  const padded = new Uint8Array(paddedLen)
  padded.set(input)
  padded[msgLen] = 0x80

  // Append length in bits as 64-bit little-endian (low 32 bits, high 32 bits)
  const bitLen = msgLen * 8
  const low = bitLen >>> 0
  const high = Math.floor(msgLen / 0x20000000) >>> 0 // msgLen * 8 >> 32
  padded[paddedLen - 8] = low & 0xff
  padded[paddedLen - 7] = (low >>> 8) & 0xff
  padded[paddedLen - 6] = (low >>> 16) & 0xff
  padded[paddedLen - 5] = (low >>> 24) & 0xff
  padded[paddedLen - 4] = high & 0xff
  padded[paddedLen - 3] = (high >>> 8) & 0xff
  padded[paddedLen - 2] = (high >>> 16) & 0xff
  padded[paddedLen - 1] = (high >>> 24) & 0xff

  // ── Step 2: initialise hash values (RFC 1321 §3.3) ─────────────────────────
  let a0 = 0x67452301 >>> 0
  let b0 = 0xefcdab89 >>> 0
  let c0 = 0x98badcfe >>> 0
  let d0 = 0x10325476 >>> 0

  // ── Step 3: process 512-bit chunks ─────────────────────────────────────────
  const view = new DataView(padded.buffer)
  for (let chunk = 0; chunk < paddedLen; chunk += 64) {
    // Read 16 little-endian 32-bit words from the chunk
    const M = new Uint32Array(16)
    for (let i = 0; i < 16; i++) {
      M[i] = view.getUint32(chunk + i * 4, /*littleEndian=*/ true)
    }

    let A = a0
    let B = b0
    let C = c0
    let D = d0

    for (let i = 0; i < 64; i++) {
      let F: number
      let g: number
      if (i < 16) {
        // Round 1: F(B,C,D) = (B & C) | (~B & D)
        F = ((B & C) | (~B & D)) >>> 0
        g = i
      } else if (i < 32) {
        // Round 2: G(B,C,D) = (D & B) | (~D & C)
        F = ((D & B) | (~D & C)) >>> 0
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        // Round 3: H(B,C,D) = B ^ C ^ D
        F = (B ^ C ^ D) >>> 0
        g = (3 * i + 5) % 16
      } else {
        // Round 4: I(B,C,D) = C ^ (B | ~D)
        F = (C ^ (B | ~D)) >>> 0
        g = (7 * i) % 16
      }

      const temp = D
      D = C
      C = B
      B = add32(B, rotl32(add32(add32(A, F), add32(M[g], MD5_T[i])), MD5_S[i]))
      A = temp
    }

    a0 = add32(a0, A)
    b0 = add32(b0, B)
    c0 = add32(c0, C)
    d0 = add32(d0, D)
  }

  // ── Step 4: produce output as little-endian bytes ──────────────────────────
  const result = new Uint8Array(16)
  const rv = new DataView(result.buffer)
  rv.setUint32(0, a0, true)
  rv.setUint32(4, b0, true)
  rv.setUint32(8, c0, true)
  rv.setUint32(12, d0, true)

  return bytesToHex(result, 'lower')
}

// ── Web Crypto wrappers ───────────────────────────────────────────────────────
//
// These are thin async wrappers around crypto.subtle.digest / importKey / sign.
// They accept Uint8Array and return lowercase hex strings.
// The functions are parameterised so they can be tested via node:crypto's webcrypto.

/** SHA algorithm name as used by SubtleCrypto. */
type ShaName = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'

/**
 * Return a Uint8Array guaranteed to be backed by a plain (non-shared) ArrayBuffer,
 * which satisfies crypto.subtle's BufferSource constraint.
 */
function ensureOwnedBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  // Copy into a fresh ArrayBuffer — this is cheap for the byte sizes we hash,
  // and it's the only way to guarantee the buffer type in strict TypeScript.
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return new Uint8Array(copy)
}

/**
 * Hash bytes with the given SubtleCrypto algorithm name.
 * Returns lowercase hex.
 */
export async function subtleDigest(bytes: Uint8Array, algorithm: ShaName): Promise<string> {
  const buffer = await crypto.subtle.digest(algorithm, ensureOwnedBuffer(bytes))
  return bytesToHex(new Uint8Array(buffer), 'lower')
}

export const sha1 = (bytes: Uint8Array): Promise<string> => subtleDigest(bytes, 'SHA-1')
export const sha256 = (bytes: Uint8Array): Promise<string> => subtleDigest(bytes, 'SHA-256')
export const sha384 = (bytes: Uint8Array): Promise<string> => subtleDigest(bytes, 'SHA-384')
export const sha512 = (bytes: Uint8Array): Promise<string> => subtleDigest(bytes, 'SHA-512')

/**
 * Compute HMAC with the given SHA algorithm name.
 * Returns lowercase hex.
 */
export async function hmacDigest(
  key: Uint8Array,
  data: Uint8Array,
  algorithm: ShaName,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    ensureOwnedBuffer(key),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  )
  const buffer = await crypto.subtle.sign('HMAC', cryptoKey, ensureOwnedBuffer(data))
  return bytesToHex(new Uint8Array(buffer), 'lower')
}

export const hmacSha1 = (key: Uint8Array, data: Uint8Array): Promise<string> =>
  hmacDigest(key, data, 'SHA-1')
export const hmacSha256 = (key: Uint8Array, data: Uint8Array): Promise<string> =>
  hmacDigest(key, data, 'SHA-256')
export const hmacSha384 = (key: Uint8Array, data: Uint8Array): Promise<string> =>
  hmacDigest(key, data, 'SHA-384')
export const hmacSha512 = (key: Uint8Array, data: Uint8Array): Promise<string> =>
  hmacDigest(key, data, 'SHA-512')

// ── Algorithm metadata ────────────────────────────────────────────────────────

export interface AlgorithmMeta {
  id: HashAlgorithmId
  label: string
  /** Digest byte length */
  digestBytes: number
  /** Whether this algorithm supports HMAC */
  hmacSupported: boolean
}

export const ALGORITHMS: AlgorithmMeta[] = [
  { id: 'md5', label: 'MD5', digestBytes: 16, hmacSupported: false },
  { id: 'sha1', label: 'SHA-1', digestBytes: 20, hmacSupported: true },
  { id: 'sha256', label: 'SHA-256', digestBytes: 32, hmacSupported: true },
  { id: 'sha384', label: 'SHA-384', digestBytes: 48, hmacSupported: true },
  { id: 'sha512', label: 'SHA-512', digestBytes: 64, hmacSupported: true },
]

/**
 * Compute all hashes for the given bytes.
 * When hmacKey is provided and non-empty, SHA-* algorithms use HMAC mode.
 * Returns a map of algorithmId → lowercase hex digest.
 */
export async function computeAllHashes(
  bytes: Uint8Array,
  hmacKey?: Uint8Array,
): Promise<Record<HashAlgorithmId, string>> {
  const useHmac = hmacKey !== undefined && hmacKey.length > 0

  const [sha1Hex, sha256Hex, sha384Hex, sha512Hex] = await Promise.all([
    useHmac ? hmacSha1(hmacKey, bytes) : sha1(bytes),
    useHmac ? hmacSha256(hmacKey, bytes) : sha256(bytes),
    useHmac ? hmacSha384(hmacKey, bytes) : sha384(bytes),
    useHmac ? hmacSha512(hmacKey, bytes) : sha512(bytes),
  ])

  return {
    md5: useHmac ? '' : md5(bytes), // HMAC-MD5 not supported
    sha1: sha1Hex,
    sha256: sha256Hex,
    sha384: sha384Hex,
    sha512: sha512Hex,
  }
}
