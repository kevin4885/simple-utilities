import { describe, expect, it } from 'vitest'
import {
  analyzeUrl,
  buildElicitResult,
  buildSamplingResult,
  capabilitiesFromSettings,
  DEFAULT_SETTINGS,
  logTone,
  needsReconnect,
  normalizeRootName,
  parseElicitationParams,
  parseLogParams,
  parseRawContent,
  parseSamplingParams,
  rootsResult,
  rootsSignature,
  snapshotSettings,
  summarizeRequest,
  validateElicitContent,
  validateRootUri,
  type ClientSettings,
} from './logic'

const settings = (over: Partial<ClientSettings> = {}): ClientSettings => ({ ...DEFAULT_SETTINGS, ...over })

describe('validateRootUri', () => {
  it.each(['file:///home/me', 'file://host/share', 'https://example.test/x', 'git+ssh://h/r', 'a1.b-c+d:rest'])(
    'accepts %s',
    (u) => expect(validateRootUri(u)).toBeNull(),
  )
  it.each(['', 'home/me', '/etc/passwd', '1http://x', ':x', 'C:\\dir with space', 'file:///a b', 'no scheme'])(
    'rejects %j',
    (u) => expect(validateRootUri(u)).not.toBeNull(),
  )
  it('rejects non-strings and over-long values', () => {
    expect(validateRootUri(undefined)).not.toBeNull()
    expect(validateRootUri(`file:///${'a'.repeat(3000)}`)).toMatch(/too long/)
  })
  it('rejects an upper-case scheme (the contract regex is lower-case only)', () => {
    expect(validateRootUri('FILE:///x')).not.toBeNull()
  })
})

describe('normalizeRootName', () => {
  it('trims and maps empty to null', () => {
    expect(normalizeRootName('  work ')).toEqual({ ok: true, name: 'work' })
    expect(normalizeRootName('   ')).toEqual({ ok: true, name: null })
    expect(normalizeRootName('x'.repeat(201)).ok).toBe(false)
  })
})

describe('rootsResult', () => {
  it('omits name when null', () => {
    expect(rootsResult([{ uri: 'file:///a', name: null }, { uri: 'file:///b', name: 'B' }])).toEqual({
      roots: [{ uri: 'file:///a' }, { uri: 'file:///b', name: 'B' }],
    })
    expect(rootsResult([])).toEqual({ roots: [] })
  })
})

describe('capabilitiesFromSettings', () => {
  it('all disabled -> {}', () => expect(capabilitiesFromSettings(DEFAULT_SETTINGS)).toEqual({}))
  it('roots', () =>
    expect(capabilitiesFromSettings(settings({ roots: { enabled: true, items: [] } }))).toEqual({ roots: {} }))
  it('sampling', () => expect(capabilitiesFromSettings(settings({ sampling: { enabled: true } }))).toEqual({ sampling: {} }))
  it('elicitation declares form and url modes', () =>
    expect(capabilitiesFromSettings(settings({ elicitation: { enabled: true } }))).toEqual({ elicitation: { form: {}, url: {} } }))
  it('combines features', () =>
    expect(
      capabilitiesFromSettings(
        settings({ roots: { enabled: true, items: [] }, sampling: { enabled: true }, elicitation: { enabled: true } }),
      ),
    ).toEqual({ roots: {}, sampling: {}, elicitation: { form: {}, url: {} } }))
})

describe('needsReconnect', () => {
  const caps = { roots: {} }
  const base = settings({ roots: { enabled: true, items: [{ uri: 'file:///a', name: null }] } })
  const applied = snapshotSettings(base, caps)

  it('is false with nothing applied or nothing changed', () => {
    expect(needsReconnect(null, base)).toBe(false)
    expect(needsReconnect(applied, base)).toBe(false)
  })
  it('is true when any feature flag differs', () => {
    expect(needsReconnect(applied, { ...base, roots: { ...base.roots, enabled: false } })).toBe(true)
    expect(needsReconnect(applied, { ...base, sampling: { enabled: true } })).toBe(true)
    expect(needsReconnect(applied, { ...base, elicitation: { enabled: true } })).toBe(true)
  })
  it('is true when the roots list was edited, false when only the logging level changed', () => {
    expect(needsReconnect(applied, { ...base, roots: { ...base.roots, items: [] } })).toBe(true)
    expect(needsReconnect(applied, { ...base, loggingLevel: 'error' })).toBe(false)
  })
  it('records whether roots.listChanged was declared', () => {
    expect(applied.rootsListChanged).toBe(false)
    expect(snapshotSettings(base, { roots: { listChanged: true } }).rootsListChanged).toBe(true)
  })
  it('rootsSignature distinguishes order and names', () => {
    const a = { uri: 'file:///a', name: null }
    const b = { uri: 'file:///b', name: 'B' }
    expect(rootsSignature([a, b])).not.toBe(rootsSignature([b, a]))
    expect(rootsSignature([a])).not.toBe(rootsSignature([{ ...a, name: 'x' }]))
  })
})

describe('parseSamplingParams', () => {
  it('extracts the fields shown to the user and keeps the rest', () => {
    const v = parseSamplingParams({
      systemPrompt: 'be brief',
      maxTokens: 50,
      modelPreferences: { hints: [{ name: 'claude' }] },
      temperature: 0.5,
      messages: [
        { role: 'user', content: { type: 'text', text: 'hi' } },
        { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
      ],
    })
    expect(v.systemPrompt).toBe('be brief')
    expect(v.maxTokens).toBe(50)
    expect(v.modelPreferences).toEqual({ hints: [{ name: 'claude' }] })
    expect(v.other).toEqual({ temperature: 0.5 })
    expect(v.messages).toEqual([
      { role: 'user', blocks: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', blocks: [{ type: 'text', text: 'a' }] },
    ])
  })
  it('survives garbage', () => {
    expect(parseSamplingParams(null).messages).toEqual([])
    expect(parseSamplingParams({ messages: [5, { role: 7 }], maxTokens: '9', systemPrompt: 4 })).toMatchObject({
      systemPrompt: null,
      maxTokens: null,
      messages: [
        { role: 'unknown', blocks: [] },
        { role: 'unknown', blocks: [] },
      ],
    })
  })
})

describe('parseElicitationParams', () => {
  it('form mode is the default and keeps an object schema', () => {
    expect(parseElicitationParams({ message: 'm', requestedSchema: { type: 'object' } })).toEqual({
      mode: 'form',
      message: 'm',
      schema: { type: 'object' },
    })
    expect(parseElicitationParams({ message: 'm', requestedSchema: 'x' })).toMatchObject({ mode: 'form', schema: null })
  })
  it('url mode', () => {
    expect(parseElicitationParams({ mode: 'url', message: 'm', url: 'https://x.test', elicitationId: 'e1' })).toEqual({
      mode: 'url',
      message: 'm',
      url: 'https://x.test',
      elicitationId: 'e1',
    })
  })
})

describe('analyzeUrl', () => {
  it('allows http and https and reports the host with its port', () => {
    expect(analyzeUrl('https://auth.example.test:8443/x?y=1')).toMatchObject({ host: 'auth.example.test:8443', openable: true, refusal: null })
    expect(analyzeUrl('http://localhost:3000/cb').openable).toBe(true)
  })
  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'ftp://x.test', 'blob:https://x.test/1', 'vbscript:x'])(
    'refuses %s',
    (u) => {
      const a = analyzeUrl(u)
      expect(a.openable).toBe(false)
      expect(a.refusal).toMatch(/Refused/)
    },
  )
  it('refuses text that is not a URL', () => {
    expect(analyzeUrl('not a url')).toMatchObject({ openable: false, host: null })
    expect(analyzeUrl('')).toMatchObject({ openable: false })
  })
  it('shows the real host of a deceptive URL and warns about embedded credentials', () => {
    const a = analyzeUrl('https://accounts.google.com@evil.test/login')
    expect(a.host).toBe('evil.test')
    expect(a.warnings).toHaveLength(1)
    expect(analyzeUrl('https://ok.test/').warnings).toEqual([])
  })
  it('shows the punycode form of a look-alike host', () => {
    expect(analyzeUrl('https://exаmple.test/').host).toMatch(/^xn--/)
  })
})

describe('summarizeRequest', () => {
  it('uses the elicitation message and truncates long text', () => {
    expect(summarizeRequest('elicitation', { message: 'Need a name' })).toBe('Need a name')
    expect(summarizeRequest('elicitation', { message: 'x'.repeat(500) })).toHaveLength(121)
  })
  it('uses the first sampling text, then the system prompt', () => {
    expect(summarizeRequest('sampling', { messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }] })).toBe('hello')
    expect(summarizeRequest('sampling', { systemPrompt: 'sys', messages: [] })).toBe('sys')
    expect(summarizeRequest('sampling', undefined)).toBe('Sampling request')
  })
})

describe('answers', () => {
  it('buildSamplingResult uses defaults for blank model / stop reason', () => {
    expect(buildSamplingResult({ text: 'hi', model: '  ', stopReason: '' })).toEqual({
      role: 'assistant',
      content: { type: 'text', text: 'hi' },
      model: 'manual',
      stopReason: 'endTurn',
    })
    expect(buildSamplingResult({ text: 'x', model: ' m1 ', stopReason: 'maxTokens' })).toMatchObject({ model: 'm1', stopReason: 'maxTokens' })
  })
  it('buildElicitResult only carries content on accept', () => {
    expect(buildElicitResult('accept', { a: 1 })).toEqual({ action: 'accept', content: { a: 1 } })
    expect(buildElicitResult('accept')).toEqual({ action: 'accept' })
    expect(buildElicitResult('decline', { a: 1 })).toEqual({ action: 'decline' })
    expect(buildElicitResult('cancel')).toEqual({ action: 'cancel' })
  })
  it('parseRawContent needs a JSON object', () => {
    expect(parseRawContent('{"a":1}')).toEqual({ ok: true, content: { a: 1 } })
    expect(parseRawContent('[1]')).toMatchObject({ ok: false })
    expect(parseRawContent('nope')).toMatchObject({ ok: false, error: expect.stringMatching(/Invalid JSON/) })
  })
  it('validateElicitContent accepts only primitives and string lists', () => {
    expect(validateElicitContent({ a: 'x', b: 1, c: true, d: ['a'] })).toBeNull()
    expect(validateElicitContent({ a: { x: 1 } })).toMatch(/"a"/)
    expect(validateElicitContent({ a: [1] })).toMatch(/"a"/)
    expect(validateElicitContent({ a: null })).toMatch(/"a"/)
  })
})

describe('server log helpers', () => {
  it('parseLogParams is defensive', () => {
    expect(parseLogParams({ level: 'warning', logger: 'db', data: { a: 1 } })).toEqual({ level: 'warning', logger: 'db', data: { a: 1 } })
    expect(parseLogParams(null)).toEqual({ level: 'unknown', logger: null, data: undefined })
  })
  it('logTone maps the 8 levels', () => {
    expect(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'].map(logTone)).toEqual([
      'quiet',
      'quiet',
      'normal',
      'warn',
      'error',
      'error',
      'error',
      'error',
    ])
    expect(logTone('weird')).toBe('normal')
  })
})
