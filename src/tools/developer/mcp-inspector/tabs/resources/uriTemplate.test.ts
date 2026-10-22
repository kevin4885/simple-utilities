import { describe, expect, it } from 'vitest'
import { expandUriTemplate, extractTemplateVariables } from './uriTemplate'

function uri(template: string, values: Record<string, string | undefined>): string {
  const r = expandUriTemplate(template, values)
  if (!r.ok) throw new Error(r.error)
  return r.uri
}

describe('extractTemplateVariables', () => {
  it('lists variables in order across operators', () => {
    expect(extractTemplateVariables('file:///{dir}/{name}{?a,b}')).toEqual(['dir', 'name', 'a', 'b'])
  })
  it('deduplicates repeated variables', () => {
    expect(extractTemplateVariables('{a}/{+a}{?a,b}')).toEqual(['a', 'b'])
  })
  it('returns [] for no variables and for unparseable templates', () => {
    expect(extractTemplateVariables('file:///plain')).toEqual([])
    expect(extractTemplateVariables('file:///{oops')).toEqual([])
    expect(extractTemplateVariables('{/x}')).toEqual([])
  })
})

describe('expandUriTemplate', () => {
  it('simple {var} percent-encodes reserved characters', () => {
    expect(uri('x://{v}', { v: 'a b/c' })).toBe('x://a%20b%2Fc')
    expect(uri('x://{v}', { v: "a?b#c&d'(e)*" })).toBe('x://a%3Fb%23c%26d%27%28e%29%2A')
  })

  it('reserved {+var} keeps "/" and reserved characters but encodes space', () => {
    expect(uri('x://{+v}', { v: 'a b/c?d' })).toBe('x://a%20b/c?d')
  })

  it('reserved {+var} does not double-encode existing %XX', () => {
    expect(uri('x://{+v}', { v: 'a%20b' })).toBe('x://a%20b')
  })

  it('fragment {#var} prefixes # and keeps reserved characters', () => {
    expect(uri('x://p{#v}', { v: 'a/b c' })).toBe('x://p#a/b%20c')
    expect(uri('x://p{#v}', {})).toBe('x://p')
  })

  it('query {?a,b} expands to ?a=1&b=2', () => {
    expect(uri('x://p{?a,b}', { a: '1', b: '2' })).toBe('x://p?a=1&b=2')
  })

  it('query omits undefined and empty variables, and the "?" when all are omitted', () => {
    expect(uri('x://p{?a,b}', { a: '1', b: undefined })).toBe('x://p?a=1')
    expect(uri('x://p{?a,b}', { a: '', b: '2' })).toBe('x://p?b=2')
    expect(uri('x://p{?a,b}', { a: '', b: undefined })).toBe('x://p')
  })

  it('query values are percent-encoded', () => {
    expect(uri('x://p{?q}', { q: 'a&b=c d' })).toBe('x://p?q=a%26b%3Dc%20d')
  })

  it('{&a} appends with "&" and is omitted when empty', () => {
    expect(uri('x://p?z=1{&a,b}', { a: 'x y', b: '2' })).toBe('x://p?z=1&a=x%20y&b=2')
    expect(uri('x://p?z=1{&a}', {})).toBe('x://p?z=1')
  })

  it('a missing simple variable expands to empty and is reported in missing', () => {
    const r = expandUriTemplate('x://{a}/{b}', { a: 'one' })
    expect(r).toEqual({ ok: true, uri: 'x://one/', missing: ['b'] })
  })

  it('treats an empty string as missing and reports each name once', () => {
    const r = expandUriTemplate('{a}{a}', { a: '' })
    expect(r).toEqual({ ok: true, uri: '', missing: ['a'] })
  })

  it('query variables are not reported as missing', () => {
    expect(expandUriTemplate('x://p{?a}', {})).toEqual({ ok: true, uri: 'x://p', missing: [] })
  })

  it('expands a comma list in a simple expression', () => {
    expect(uri('x://{a,b}', { a: '1', b: '2' })).toBe('x://1,2')
  })

  it('does not read inherited object properties as values', () => {
    expect(expandUriTemplate('{toString}', {})).toEqual({ ok: true, uri: '', missing: ['toString'] })
  })

  it.each([
    ['{/x}', "'/'"],
    ['{.x}', "'.'"],
    ['{;x}', "';'"],
    ['{x*}', "'*'"],
    ['{x:3}', "':'"],
  ])('rejects unsupported %s naming it', (template, named) => {
    const r = expandUriTemplate(`x://${template}`, { x: 'v' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain(named)
      expect(r.error).toContain(template)
    }
  })

  it('rejects an unmatched "{"', () => {
    const r = expandUriTemplate('x://{a', { a: '1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Unmatched '\{'/)
  })

  it('rejects a nested "{" and an unmatched "}"', () => {
    expect(expandUriTemplate('x://{a{b}', {}).ok).toBe(false)
    expect(expandUriTemplate('x://a}', {}).ok).toBe(false)
  })

  it('rejects empty expressions and invalid variable names', () => {
    expect(expandUriTemplate('x://{}', {}).ok).toBe(false)
    expect(expandUriTemplate('x://{a b}', {}).ok).toBe(false)
    expect(expandUriTemplate('x://{a,}', {}).ok).toBe(false)
  })

  it('returns an error rather than throwing for lone surrogates', () => {
    const r = expandUriTemplate('x://{v}', { v: '\ud800' })
    expect(r.ok).toBe(false)
  })

  it('a template with no expressions is returned unchanged', () => {
    expect(uri('file:///etc/hosts', {})).toBe('file:///etc/hosts')
  })
})
