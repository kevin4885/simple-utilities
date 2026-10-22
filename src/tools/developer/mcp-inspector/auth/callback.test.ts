import { describe, expect, it } from 'vitest'
import callbackSource from './callback.ts?raw'
import pageSource from './OAuthCallbackPage.tsx?raw'
import secretsSource from '../secrets.ts?raw'
import {
  OAUTH_CHANNEL,
  isOAuthCallbackMessage,
  oauthSecretKey,
  parseCallbackParams,
  toCallbackMessage,
  validateState,
} from './callback'

describe('parseCallbackParams', () => {
  it('reads code and state', () => {
    expect(parseCallbackParams('?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz', error: null, errorDescription: null })
  })

  it('reads a provider error and leaves code null', () => {
    expect(parseCallbackParams('?error=access_denied&error_description=No')).toEqual({
      code: null,
      state: null,
      error: 'access_denied',
      errorDescription: 'No',
    })
  })

  it('returns all-null for an empty query', () => {
    expect(parseCallbackParams('')).toEqual({ code: null, state: null, error: null, errorDescription: null })
  })

  it('treats empty values like missing ones and decodes percent-escapes', () => {
    expect(parseCallbackParams('?code=&state=a%20b')).toEqual({ code: null, state: 'a b', error: null, errorDescription: null })
  })
})

describe('validateState', () => {
  it('is true only for equal non-empty values', () => {
    expect(validateState('abc', 'abc')).toBe(true)
  })

  it.each([
    [null, 'abc'],
    ['abc', null],
    [null, null],
    ['', ''],
    ['abc', ''],
    ['', 'abc'],
    [undefined, 'abc'],
    ['abc', 'abd'],
    ['abc', 'ABC'],
  ])('is false for %j vs %j', (expected, got) => {
    expect(validateState(expected, got)).toBe(false)
  })
})

describe('message helpers', () => {
  it('toCallbackMessage tags the params', () => {
    expect(toCallbackMessage({ code: 'c', state: 's', error: null, errorDescription: null })).toEqual({
      type: 'mcp-oauth-callback',
      state: 's',
      code: 'c',
      error: null,
      errorDescription: null,
    })
  })

  it('isOAuthCallbackMessage accepts well-formed messages only', () => {
    const ok = { type: 'mcp-oauth-callback', state: 's', code: 'c', error: null, errorDescription: null }
    expect(isOAuthCallbackMessage(ok)).toBe(true)
    expect(isOAuthCallbackMessage({ ...ok, code: 5 })).toBe(false)
    expect(isOAuthCallbackMessage({ ...ok, type: 'other' })).toBe(false)
    expect(isOAuthCallbackMessage({ type: 'mcp-oauth-callback' })).toBe(false)
    expect(isOAuthCallbackMessage(null)).toBe(false)
    expect(isOAuthCallbackMessage('mcp-oauth-callback')).toBe(false)
  })

  it('uses the documented channel name and key layout', () => {
    expect(OAUTH_CHANNEL).toBe('su-mcp-oauth')
    expect(oauthSecretKey('p1', 'tokens')).toBe('oauth:p1:tokens')
    expect(oauthSecretKey('p1', 'verifier')).toBe('oauth:p1:verifier')
  })
})

describe('callback route import graph', () => {
  const importSpecifiers = (source: string) =>
    [...source.matchAll(/(?:^|\n)\s*import\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g)].map((m) => m[1])

  it('callback.ts imports nothing', () => {
    expect(importSpecifiers(callbackSource)).toEqual([])
  })

  it('the page imports only react, react-router, callback.ts and secrets.ts', () => {
    const specs = importSpecifiers(pageSource)
    expect(specs.sort()).toEqual(['../secrets', './callback', 'react', 'react-router'].sort())
  })

  it('secrets.ts (the only non-SDK-free-by-construction dependency) reaches only zod', () => {
    expect(importSpecifiers(secretsSource)).toEqual(['zod'])
  })

  it('no module in the graph mentions the MCP SDK', () => {
    for (const source of [callbackSource, pageSource, secretsSource]) {
      expect(source).not.toMatch(/@modelcontextprotocol/)
    }
  })
})
