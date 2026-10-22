import { describe, expect, it } from 'vitest'
import { ProtocolError, SdkError, SdkErrorCode } from '@modelcontextprotocol/client'
import type { HistoryEntry } from '../../schemas'
import {
  annotationBadges,
  argsPreview,
  argumentsToFormValue,
  checkOutputSchema,
  classifyCallError,
  classifyCallResult,
  clampTimeoutMs,
  countLabel,
  filterTools,
  formBlockedReason,
  formToJsonText,
  initialDraft,
  isDestructive,
  jsonTextToForm,
  loadHistoryArgs,
  normalizeTool,
  parseArgsText,
  parseToolsPage,
  progressView,
  switchMode,
  toolHistory,
  toolLabel,
  truncationNotice,
  type McpTool,
} from './logic'

const tool = (over: Record<string, unknown> = {}): McpTool => {
  const t = normalizeTool({ name: 't', inputSchema: { type: 'object' }, ...over })
  if (!t) throw new Error('bad fixture')
  return t
}

const COUNT_SCHEMA = { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] }

describe('normalizeTool / parseToolsPage', () => {
  it('keeps name/title/description/schemas and only boolean annotations', () => {
    const t = normalizeTool({
      name: 'a',
      title: 'A',
      description: 'desc',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, destructiveHint: 'yes', idempotentHint: false, title: 'x' },
    })
    expect(t).toEqual({
      name: 'a',
      title: 'A',
      description: 'desc',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, idempotentHint: false },
    })
  })

  it('rejects entries without a string name and defaults a missing inputSchema to {}', () => {
    expect(normalizeTool(null)).toBeNull()
    expect(normalizeTool({ name: 5 })).toBeNull()
    expect(normalizeTool({ name: '' })).toBeNull()
    expect(normalizeTool({ name: 'x' })?.inputSchema).toEqual({})
    expect(normalizeTool({ name: 'x', title: '  ', description: '' })).toMatchObject({ title: undefined, description: undefined })
  })

  it('parses a page, skipping unusable tools, and carries nextCursor only when non-empty', () => {
    expect(parseToolsPage({ tools: [{ name: 'a' }, { nope: 1 }], nextCursor: 'c1' })).toEqual({
      items: [expect.objectContaining({ name: 'a' })],
      nextCursor: 'c1',
    })
    expect(parseToolsPage({ tools: [], nextCursor: '' })).toEqual({ items: [] })
  })

  it('throws on a result that is not a tools page', () => {
    expect(() => parseToolsPage({})).toThrow(/tools/)
    expect(() => parseToolsPage(null)).toThrow()
    expect(() => parseToolsPage({ tools: 'x' })).toThrow()
  })
})

describe('listing helpers', () => {
  const tools = [
    tool({ name: 'get_weather', title: 'Weather', description: 'Forecast for a CITY' }),
    tool({ name: 'delete_file', description: 'Removes a file' }),
    tool({ name: 'ping' }),
  ]

  it('toolLabel prefers the title', () => {
    expect(toolLabel(tools[0])).toBe('Weather')
    expect(toolLabel(tools[1])).toBe('delete_file')
  })

  it('filters case-insensitively across name, title and description; blank keeps all', () => {
    expect(filterTools(tools, 'WEATHER').map((t) => t.name)).toEqual(['get_weather'])
    expect(filterTools(tools, 'city').map((t) => t.name)).toEqual(['get_weather'])
    expect(filterTools(tools, 'DELETE_').map((t) => t.name)).toEqual(['delete_file'])
    expect(filterTools(tools, 'zzz')).toEqual([])
    expect(filterTools(tools, '   ')).toBe(tools)
  })

  it('countLabel pluralises and shows the filtered share', () => {
    expect(countLabel(5, 5)).toBe('5 tools')
    expect(countLabel(1, 1)).toBe('1 tool')
    expect(countLabel(0, 0)).toBe('0 tools')
    expect(countLabel(2, 5)).toBe('2 of 5 tools')
  })

  it('emits a badge only for hints the server sent', () => {
    expect(annotationBadges(tool())).toEqual([])
    const labels = annotationBadges(
      tool({ annotations: { readOnlyHint: true, destructiveHint: true, idempotentHint: true, openWorldHint: true } }),
    ).map((b) => b.label)
    expect(labels).toEqual(['read-only', 'destructive', 'idempotent', 'open-world'])
    expect(annotationBadges(tool({ annotations: { readOnlyHint: false } }))).toEqual([
      { key: 'readOnlyHint', value: false, label: 'not read-only' },
    ])
  })

  it('isDestructive is true only for an explicit destructiveHint: true', () => {
    expect(isDestructive(tool({ annotations: { destructiveHint: true } }))).toBe(true)
    expect(isDestructive(tool({ annotations: { destructiveHint: false } }))).toBe(false)
    expect(isDestructive(tool({ annotations: { readOnlyHint: true } }))).toBe(false)
    expect(isDestructive(tool())).toBe(false)
  })

  it('truncationNotice names the reason', () => {
    expect(truncationNotice('cursor-loop')).toMatch(/already returned/)
    expect(truncationNotice('max-pages')).toMatch(/page limit/)
  })
})

describe('clampTimeoutMs', () => {
  it('defaults blank/garbage, clamps to the minimum and maximum, rounds', () => {
    expect(clampTimeoutMs('')).toBe(60000)
    expect(clampTimeoutMs('abc')).toBe(60000)
    expect(clampTimeoutMs('10')).toBe(1000)
    expect(clampTimeoutMs(-5)).toBe(1000)
    expect(clampTimeoutMs('1000')).toBe(1000)
    expect(clampTimeoutMs('2500.6')).toBe(2501)
    expect(clampTimeoutMs('99999999999')).toBe(3_600_000)
  })
})

describe('parseArgsText', () => {
  it('blank is {}', () => {
    expect(parseArgsText('  ')).toEqual({ ok: true, value: {} })
  })
  it('accepts objects, rejects arrays, primitives and malformed text', () => {
    expect(parseArgsText('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseArgsText('[1]')).toMatchObject({ ok: false, error: 'Arguments must be a JSON object' })
    expect(parseArgsText('5')).toMatchObject({ ok: false })
    expect(parseArgsText('null')).toMatchObject({ ok: false })
    expect(parseArgsText('{"a":')).toMatchObject({ ok: false })
  })
})

describe('form <-> JSON conversion', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      count: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
      extra: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    },
    required: ['name'],
  }

  it('formToJsonText writes pretty toArguments output', () => {
    const r = formToJsonText(schema, { name: 'x', count: '3', tags: ['a'] })
    expect(r.errors).toEqual([])
    expect(JSON.parse(r.text)).toEqual({ name: 'x', count: 3, tags: ['a'] })
    expect(r.text).toContain('\n  "name"')
  })

  it('formToJsonText gives {} plus the errors when the form is invalid', () => {
    const r = formToJsonText(COUNT_SCHEMA, {})
    expect(r.text).toBe('{}')
    expect(r.errors).toEqual([{ path: 'count', message: 'Required' }])
  })

  it('jsonTextToForm loads values; numbers stay editable and unsupported fields become JSON text', () => {
    const r = jsonTextToForm(schema, '{"name":"x","count":3,"extra":5}')
    expect(r).toMatchObject({ ok: true, dropped: [] })
    if (!r.ok) return
    expect(r.value).toEqual({ name: 'x', count: 3, extra: '5' })
    // and it converts back to the same arguments
    expect(formToJsonText(schema, r.value).errors).toEqual([])
  })

  it('reports keys the form has no field for instead of keeping them silently', () => {
    const r = argumentsToFormValue(schema, { name: 'x', stray: 1 })
    expect(r.dropped).toEqual(['stray'])
    expect(r.value).toEqual({ name: 'x' })
  })

  it('reports nested unknown keys with their path', () => {
    const nested = { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'string' } } } } }
    expect(argumentsToFormValue(nested, { a: { b: 'x', c: 1 } }).dropped).toEqual(['a.c'])
  })

  it('jsonTextToForm fails on invalid JSON', () => {
    expect(jsonTextToForm(schema, '{')).toMatchObject({ ok: false })
  })

  it('a __proto__ key in the arguments does not pollute the result', () => {
    const r = argumentsToFormValue({ type: 'object', properties: { ['__proto__']: { type: 'string' } } }, JSON.parse('{"__proto__":"x"}'))
    expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype)
    expect(Object.keys(r.value as object)).toEqual(['__proto__'])
  })
})

describe('draft mode switching', () => {
  it('starts in form mode for a supported schema and json mode otherwise', () => {
    expect(initialDraft(tool({ inputSchema: COUNT_SCHEMA })).mode).toBe('form')
    expect(initialDraft(tool({ inputSchema: { oneOf: [{ type: 'object' }] } })).mode).toBe('json')
    expect(initialDraft(tool({ inputSchema: { type: 'string' } })).mode).toBe('json')
  })

  it('Form -> JSON writes the arguments; invalid form gives {} and the errors', () => {
    const d = { ...initialDraft(tool({ inputSchema: COUNT_SCHEMA })) }
    const bad = switchMode(COUNT_SCHEMA, d, 'json')
    expect(bad.draft).toMatchObject({ mode: 'json', jsonText: '{}' })
    expect(bad.errors).toEqual([{ path: 'count', message: 'Required' }])
    const good = switchMode(COUNT_SCHEMA, { ...d, formValue: { count: '4' } }, 'json')
    expect(JSON.parse(good.draft.jsonText)).toEqual({ count: 4 })
    expect(good.errors).toEqual([])
  })

  it('JSON -> Form loads values; invalid JSON stays in JSON with a notice', () => {
    const d = { mode: 'json' as const, formValue: {}, jsonText: '{"count": 9}' }
    const ok = switchMode(COUNT_SCHEMA, d, 'form')
    expect(ok.draft).toMatchObject({ mode: 'form', formValue: { count: 9 } })
    const bad = switchMode(COUNT_SCHEMA, { ...d, jsonText: '{' }, 'form')
    expect(bad.draft.mode).toBe('json')
    expect(bad.notice).toMatch(/Invalid JSON/)
  })

  it('JSON -> Form mentions dropped keys', () => {
    const d = { mode: 'json' as const, formValue: {}, jsonText: '{"count": 1, "zzz": true}' }
    const r = switchMode(COUNT_SCHEMA, d, 'form')
    expect(r.draft.mode).toBe('form')
    expect(r.notice).toMatch(/dropped: zzz/)
  })

  it('formBlockedReason explains an unsupported schema or invalid JSON; null otherwise', () => {
    const json = { mode: 'json' as const, formValue: {}, jsonText: '{' }
    expect(formBlockedReason({ type: 'string' }, json)).toMatch(/expected "object"/)
    expect(formBlockedReason(COUNT_SCHEMA, json)).toMatch(/^Invalid JSON/)
    expect(formBlockedReason(COUNT_SCHEMA, { ...json, jsonText: '{}' })).toBeNull()
    expect(formBlockedReason(COUNT_SCHEMA, { ...json, mode: 'form' })).toBeNull()
  })

  it('switching to the current mode is a no-op', () => {
    const d = initialDraft(tool({ inputSchema: COUNT_SCHEMA }))
    expect(switchMode(COUNT_SCHEMA, d, 'form').draft).toBe(d)
  })

  it('loadHistoryArgs fills the form in form mode, JSON text in json mode, and keeps broken text', () => {
    const form = initialDraft(tool({ inputSchema: COUNT_SCHEMA }))
    expect(loadHistoryArgs(COUNT_SCHEMA, form, '{"count":7}').draft).toMatchObject({ mode: 'form', formValue: { count: 7 } })
    const json = { ...form, mode: 'json' as const }
    const j = loadHistoryArgs(COUNT_SCHEMA, json, '{"count":7}')
    expect(j.draft.mode).toBe('json')
    expect(JSON.parse(j.draft.jsonText)).toEqual({ count: 7 })
    const broken = loadHistoryArgs(COUNT_SCHEMA, form, '{"count": 1…[truncated]')
    expect(broken.draft).toMatchObject({ mode: 'json', jsonText: '{"count": 1…[truncated]' })
    expect(broken.notice).toMatch(/not valid JSON/)
    const unsupported = loadHistoryArgs({ type: 'string' }, form, '{"a":1}')
    expect(unsupported.draft.mode).toBe('json')
  })
})

describe('call classification', () => {
  it('isError:true is a tool error; other objects are success; non-objects fail', () => {
    expect(classifyCallResult({ content: [], isError: true }).kind).toBe('tool-error')
    expect(classifyCallResult({ content: [] }).kind).toBe('success')
    expect(classifyCallResult({ isError: false }).kind).toBe('success')
    expect(classifyCallResult('x').kind).toBe('failed')
    expect(classifyCallResult(null).kind).toBe('failed')
  })

  it('maps SDK errors to distinct outcomes', () => {
    const o = { timeoutMs: 5000, aborted: false }
    expect(classifyCallError(new ProtocolError(-32602, 'bad', { x: 1 }), o)).toEqual({
      kind: 'protocol-error',
      error: { code: -32602, message: 'bad', data: { x: 1 } },
    })
    expect(classifyCallError(new ProtocolError(-32601, 'nope'), o)).toEqual({
      kind: 'protocol-error',
      error: { code: -32601, message: 'nope' },
    })
    expect(classifyCallError(new SdkError(SdkErrorCode.RequestTimeout, 'slow'), o)).toEqual({ kind: 'timeout', timeoutMs: 5000 })
    expect(classifyCallError(new TypeError('Failed to fetch'), o)).toEqual({ kind: 'failed', message: 'Failed to fetch' })
  })

  it('an aborted call is cancelled whatever the error was', () => {
    expect(classifyCallError(new Error('whatever'), { timeoutMs: 1, aborted: true })).toEqual({ kind: 'cancelled' })
    expect(classifyCallError(new SdkError(SdkErrorCode.RequestTimeout, 'slow'), { timeoutMs: 1, aborted: true }).kind).toBe('cancelled')
  })
})

describe('checkOutputSchema', () => {
  const withOut = tool({ outputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] } })
  const ok = (sc?: unknown) => classifyCallResult({ content: [], ...(sc === undefined ? {} : { structuredContent: sc }) })

  it('is none without an outputSchema', () => {
    expect(checkOutputSchema(tool(), ok({ n: 1 }))).toEqual({ status: 'none' })
  })
  it('valid structuredContent passes', () => {
    expect(checkOutputSchema(withOut, ok({ n: 1 }))).toEqual({ status: 'valid' })
  })
  it('missing structuredContent is invalid at the root', () => {
    const r = checkOutputSchema(withOut, ok())
    expect(r.status).toBe('invalid')
    expect(r.status === 'invalid' && r.issues[0]).toMatch(/^\(root\): .*no structuredContent/)
  })
  it('mismatching structuredContent lists the paths', () => {
    const r = checkOutputSchema(withOut, ok({ n: 'x' }))
    expect(r).toEqual({ status: 'invalid', issues: ['n: Expected number, got string'] })
    const missing = checkOutputSchema(withOut, ok({}))
    expect(missing).toEqual({ status: 'invalid', issues: ['n: Required'] })
  })
  it('is skipped for tool errors and protocol failures', () => {
    expect(checkOutputSchema(withOut, classifyCallResult({ content: [], isError: true }))).toEqual({ status: 'skipped' })
    expect(checkOutputSchema(withOut, { kind: 'cancelled' })).toEqual({ status: 'skipped' })
  })
})

describe('progressView', () => {
  it('computes a fraction when a total is known', () => {
    expect(progressView({ progress: 5, total: 10 })).toEqual({ fraction: 0.5, label: '5 / 10', message: null })
    expect(progressView({ progress: 50, total: 10 }).fraction).toBe(1)
    expect(progressView({ progress: 3, total: 10, message: 'step' }).message).toBe('step')
  })
  it('is indeterminate without a usable total', () => {
    expect(progressView({ progress: 4 })).toEqual({ fraction: null, label: '4', message: null })
    expect(progressView({ progress: 4, total: 0 }).fraction).toBeNull()
  })
})

describe('toolHistory / argsPreview', () => {
  const h = (id: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
    id,
    ts: 1,
    profileId: 'p',
    kind: 'tool',
    name: 't',
    argsJson: '{}',
    ok: true,
    durationMs: 1,
    ...over,
  })
  it('filters by profile, kind and tool name and returns newest first', () => {
    const all = [h('1'), h('2', { profileId: 'q' }), h('3', { kind: 'prompt' }), h('4', { name: 'other' }), h('5')]
    expect(toolHistory(all, 'p', 't').map((x) => x.id)).toEqual(['5', '1'])
    expect(all.map((x) => x.id)).toEqual(['1', '2', '3', '4', '5']) // input untouched
  })
  it('argsPreview flattens whitespace and truncates', () => {
    expect(argsPreview('{\n  "a": 1\n}')).toBe('{ "a": 1 }')
    expect(argsPreview('x'.repeat(200), 10)).toBe('xxxxxxxxxx…')
  })
})
