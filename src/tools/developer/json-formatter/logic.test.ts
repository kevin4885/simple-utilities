import { describe, it, expect } from 'vitest'
import { validateJson, formatJson, minifyJson } from './logic'

// ── validateJson ──────────────────────────────────────────────────────────────

describe('validateJson', () => {
  it('returns ok for valid JSON object', () => {
    expect(validateJson('{"a":1}')).toEqual({ ok: true })
  })

  it('returns ok for valid JSON array', () => {
    expect(validateJson('[1,2,3]')).toEqual({ ok: true })
  })

  it('returns ok for JSON null', () => {
    expect(validateJson('null')).toEqual({ ok: true })
  })

  it('returns ok for JSON string', () => {
    expect(validateJson('"hello"')).toEqual({ ok: true })
  })

  it('returns ok for JSON number', () => {
    expect(validateJson('42')).toEqual({ ok: true })
  })

  it('returns error for empty input', () => {
    const r = validateJson('')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('returns error for whitespace-only input', () => {
    const r = validateJson('   \n\t  ')
    expect(r.ok).toBe(false)
  })

  it('returns error for invalid JSON', () => {
    const r = validateJson('{a:1}')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('returns error with line/column for trailing comma', () => {
    const r = validateJson('{"a":1,}')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    // line/column are best-effort — just check they're positive numbers when present
    if (r.line !== undefined) expect(r.line).toBeGreaterThan(0)
    if (r.column !== undefined) expect(r.column).toBeGreaterThan(0)
  })

  it('handles unicode in valid JSON', () => {
    expect(validateJson('{"emoji":"\\uD83D\\uDE00"}')).toEqual({ ok: true })
    expect(validateJson('{"text":"héllo wörld"}')).toEqual({ ok: true })
  })

  it('handles nested structures', () => {
    const nested = JSON.stringify({ a: { b: { c: [1, 2, { d: true }] } } })
    expect(validateJson(nested)).toEqual({ ok: true })
  })
})

// ── formatJson ────────────────────────────────────────────────────────────────

describe('formatJson', () => {
  const opts2 = { indent: 2 as const, sortKeys: false }
  const opts4 = { indent: 4 as const, sortKeys: false }
  const optsTab = { indent: 'tab' as const, sortKeys: false }

  it('formats with 2-space indent', () => {
    const result = formatJson('{"b":2,"a":1}', opts2)
    expect(result).toBe('{\n  "b": 2,\n  "a": 1\n}')
  })

  it('formats with 4-space indent', () => {
    const result = formatJson('{"a":1}', opts4)
    expect(result).toBe('{\n    "a": 1\n}')
  })

  it('formats with tab indent', () => {
    const result = formatJson('{"a":1}', optsTab)
    expect(result).toBe('{\n\t"a": 1\n}')
  })

  it('returns null for invalid JSON', () => {
    expect(formatJson('{bad}', opts2)).toBeNull()
  })

  it('sorts keys when sortKeys=true', () => {
    const result = formatJson('{"z":3,"a":1,"m":2}', { indent: 2, sortKeys: true })
    expect(result).toBe('{\n  "a": 1,\n  "m": 2,\n  "z": 3\n}')
  })

  it('sorts keys recursively', () => {
    const input = JSON.stringify({ z: { b: 2, a: 1 }, a: [3, 2, 1] })
    const result = formatJson(input, { indent: 2, sortKeys: true })!
    const parsed = JSON.parse(result) as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual(['a', 'z'])
    expect(Object.keys(parsed.z as object)).toEqual(['a', 'b'])
    // array order preserved
    expect((parsed.a as number[])).toEqual([3, 2, 1])
  })

  it('does not sort keys when sortKeys=false', () => {
    const result = formatJson('{"z":3,"a":1}', opts2)
    const parsed = JSON.parse(result!) as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual(['z', 'a'])
  })

  it('handles unicode values', () => {
    const result = formatJson('{"flag":"\\uD83C\\uDDFA\\uD83C\\uDDF8"}', opts2)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!) as Record<string, unknown>
    expect(parsed.flag).toBe('🇺🇸')
  })

  it('handles arrays', () => {
    const result = formatJson('[1,2,3]', opts2)
    expect(result).toBe('[\n  1,\n  2,\n  3\n]')
  })

  it('handles null, booleans, numbers as root', () => {
    expect(formatJson('null', opts2)).toBe('null')
    expect(formatJson('true', opts2)).toBe('true')
    expect(formatJson('42', opts2)).toBe('42')
  })
})

// ── minifyJson ────────────────────────────────────────────────────────────────

describe('minifyJson', () => {
  it('removes all whitespace from formatted JSON', () => {
    const formatted = '{\n  "a": 1,\n  "b": 2\n}'
    expect(minifyJson(formatted)).toBe('{"a":1,"b":2}')
  })

  it('returns same string for already-minified JSON', () => {
    expect(minifyJson('{"a":1}')).toBe('{"a":1}')
  })

  it('returns null for invalid JSON', () => {
    expect(minifyJson('{bad}')).toBeNull()
  })

  it('handles nested structures', () => {
    const input = '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": true\n  }\n}'
    expect(minifyJson(input)).toBe('{"a":[1,2],"b":{"c":true}}')
  })

  it('handles unicode', () => {
    const input = '{"text": "héllo \\u1234"}'
    const result = minifyJson(input)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual({ text: 'héllo \u1234' })
  })
})
