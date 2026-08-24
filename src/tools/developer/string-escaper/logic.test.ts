import { describe, it, expect } from 'vitest'
import { unescapeString, escapeString } from './logic'

// ── unescapeString ────────────────────────────────────────────────────────────

describe('unescapeString', () => {
  it('unescapes \\n \\t \\r', () => {
    const r = unescapeString('hello\\nworld\\ttab\\r')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('hello\nworld\ttab\r')
  })

  it('unescapes \\\\ and \\"', () => {
    const r = unescapeString('she said \\"hi\\" and \\\\ that')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('she said "hi" and \\ that')
  })

  it('unescapes \\b \\f \\/ \\0', () => {
    const r = unescapeString('\\b\\f\\/')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('\b\f/')
  })

  it('unescapes \\uXXXX', () => {
    const r = unescapeString('caf\\u00e9')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('café')
  })

  it('unescapes surrogate pair for emoji', () => {
    // 😀 = U+1F600 → \uD83D\uDE00
    const r = unescapeString('smile: \\uD83D\\uDE00')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('smile: 😀')
  })

  it('unescapes flag emoji (4-unit surrogate sequence)', () => {
    // 🇺🇸 = U+1F1FA U+1F1F8 (2 supplementary chars)
    // each = \uD83C\uDDFA and \uD83C\uDDF8
    const r = unescapeString('\\uD83C\\uDDFA\\uD83C\\uDDF8')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('🇺🇸')
  })

  it('auto-strips surrounding double quotes', () => {
    const r = unescapeString('"hello\\nworld"')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('hello\nworld')
  })

  it('does not strip mismatched quotes', () => {
    const r = unescapeString('"no closing')
    expect(r.ok).toBe(true)
    // starts with " but doesn't end with " — should NOT strip
    expect(r.value.charAt(0)).toBe('"')
  })

  it('passes through unknown escape sequences', () => {
    const r = unescapeString('foo\\qbar')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('foo\\qbar')
  })

  it('handles lone high surrogate gracefully', () => {
    const r = unescapeString('\\uD83D')
    expect(r.ok).toBe(true)
    // Should substitute replacement character, not throw
    expect(r.value).toBe('\uFFFD')
  })

  it('handles lone low surrogate gracefully', () => {
    const r = unescapeString('\\uDE00')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('\uFFFD')
  })

  it('handles trailing backslash gracefully', () => {
    const r = unescapeString('foo\\')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('foo\\')
  })

  it('handles empty input', () => {
    const r = unescapeString('')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('')
  })

  it('handles input with no escapes', () => {
    const r = unescapeString('plain text')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('plain text')
  })

  it('handles invalid \\uXXXX (non-hex)', () => {
    const r = unescapeString('\\uZZZZ')
    expect(r.ok).toBe(true)
    // Passes through \\u literally
    expect(r.value).toBe('\\uZZZZ')
  })
})

// ── escapeString ──────────────────────────────────────────────────────────────

describe('escapeString', () => {
  it('escapes \\n \\t \\r', () => {
    expect(escapeString('hello\nworld\ttab\r')).toBe('hello\\nworld\\ttab\\r')
  })

  it('escapes \\\\ and "', () => {
    expect(escapeString('she said "hi" and \\ that')).toBe(
      'she said \\"hi\\" and \\\\ that',
    )
  })

  it('escapes \\b \\f', () => {
    expect(escapeString('\b\f')).toBe('\\b\\f')
  })

  it('wraps in quotes when quotes=true', () => {
    expect(escapeString('hello\nworld', { quotes: true })).toBe('"hello\\nworld"')
  })

  it('does not wrap in quotes when quotes=false', () => {
    expect(escapeString('hello\nworld', { quotes: false })).toBe('hello\\nworld')
  })

  it('default quotes=false', () => {
    expect(escapeString('hi')).toBe('hi')
  })

  it('escapes emoji via surrogate pairs', () => {
    // 😀 = U+1F600 → \ud83d\ude00 (lowercase hex, as produced by toString(16))
    const result = escapeString('😀')
    expect(result).toBe('\\ud83d\\ude00')
  })

  it('escapes flag emoji', () => {
    // 🇺🇸 = two supplementary chars → lowercase hex
    const result = escapeString('🇺🇸')
    expect(result).toBe('\\ud83c\\uddfa\\ud83c\\uddf8')
  })

  it('round-trips: escape → unescape recovers original', () => {
    const original = 'Line 1\nLine 2\t"quoted"\\\nUnicode: café 😀'
    const escaped = escapeString(original)
    const unescaped = unescapeString(escaped)
    expect(unescaped.ok).toBe(true)
    expect(unescaped.value).toBe(original)
  })

  it('does not escape normal ASCII', () => {
    expect(escapeString('hello world 123 !@#')).toBe('hello world 123 !@#')
  })

  it('escapes control characters below 0x20', () => {
    const r = escapeString('\x01\x1f')
    expect(r).toBe('\\u0001\\u001f')
  })

  it('handles empty input', () => {
    expect(escapeString('')).toBe('')
  })
})
