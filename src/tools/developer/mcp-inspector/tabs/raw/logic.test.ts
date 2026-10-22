import { describe, expect, it } from 'vitest'
import {
  historyArgs,
  isBlockedMethod,
  KNOWN_METHODS,
  MIN_TIMEOUT_MS,
  parseRawParams,
  parseTimeoutMs,
} from './logic'

describe('parseRawParams', () => {
  it('treats empty and whitespace as no params', () => {
    expect(parseRawParams('')).toEqual({ ok: true, params: undefined })
    expect(parseRawParams('  \n\t ')).toEqual({ ok: true, params: undefined })
  })

  it('accepts objects and arrays', () => {
    expect(parseRawParams('{"a":1}')).toEqual({ ok: true, params: { a: 1 } })
    expect(parseRawParams(' [1,2] ')).toEqual({ ok: true, params: [1, 2] })
    expect(parseRawParams('{}')).toEqual({ ok: true, params: {} })
  })

  it.each(['42', '"s"', 'null', 'true'])('rejects the non-structured value %s', (text) => {
    const r = parseRawParams(text)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/object or array/)
  })

  it('reports malformed JSON with a line and column', () => {
    const r = parseRawParams('{\n  "a": 1,\n  "b": }')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/line \d+, column \d+/)
  })

  it('reports truncated JSON with a position too', () => {
    const r = parseRawParams('{"a":')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/line \d+, column \d+/)
  })
})

describe('isBlockedMethod', () => {
  it('blocks initialize, notifications/initialized and empty methods with distinct messages', () => {
    const a = isBlockedMethod('initialize')
    const b = isBlockedMethod('notifications/initialized')
    const c = isBlockedMethod('')
    const d = isBlockedMethod('   ')
    expect(a).toMatch(/Use Reconnect to re-initialize/)
    expect(b).toMatch(/Use Reconnect to re-initialize/)
    expect(c).not.toBeNull()
    expect(d).toBe(c)
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('allows everything else, including custom methods', () => {
    expect(isBlockedMethod('ping')).toBeNull()
    expect(isBlockedMethod('tools/list')).toBeNull()
    expect(isBlockedMethod('custom/anything')).toBeNull()
    expect(isBlockedMethod('notifications/cancelled')).toBeNull()
  })

  it('ignores surrounding whitespace when matching blocked names', () => {
    expect(isBlockedMethod(' initialize ')).not.toBeNull()
  })
})

describe('KNOWN_METHODS', () => {
  it('includes the standard client requests', () => {
    for (const m of [
      'ping',
      'tools/list',
      'tools/call',
      'resources/list',
      'resources/templates/list',
      'resources/read',
      'resources/subscribe',
      'resources/unsubscribe',
      'prompts/list',
      'prompts/get',
      'completion/complete',
      'logging/setLevel',
    ]) {
      expect(KNOWN_METHODS).toContain(m)
    }
  })

  it('does not suggest blocked methods', () => {
    for (const m of KNOWN_METHODS) expect(isBlockedMethod(m)).toBeNull()
  })
})

describe('parseTimeoutMs', () => {
  it('accepts the minimum and above', () => {
    expect(parseTimeoutMs('60000')).toEqual({ ok: true, ms: 60000 })
    expect(parseTimeoutMs(String(MIN_TIMEOUT_MS))).toEqual({ ok: true, ms: MIN_TIMEOUT_MS })
    expect(parseTimeoutMs(' 2500 ')).toEqual({ ok: true, ms: 2500 })
  })

  it.each(['999', '0', '', 'abc', '-5', '1.5', '1e4'])('rejects %j', (text) => {
    expect(parseTimeoutMs(text).ok).toBe(false)
  })
})

describe('historyArgs', () => {
  it('records {} for empty params and the text otherwise', () => {
    expect(historyArgs('')).toBe('{}')
    expect(historyArgs('  ')).toBe('{}')
    expect(historyArgs('{"a":1}')).toBe('{"a":1}')
  })
})
