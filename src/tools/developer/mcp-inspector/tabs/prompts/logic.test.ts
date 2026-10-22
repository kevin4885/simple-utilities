import { describe, expect, it } from 'vitest'
import { initialFormValue, lintJsonSchema } from '../../schema-form'
import { buildPromptArguments, filterPrompts, parsePromptArguments, promptArgsToSchema, promptMessages } from './logic'

describe('promptArgsToSchema', () => {
  it('builds string properties and lists only required ones', () => {
    expect(
      promptArgsToSchema([
        { name: 'code', description: 'The code', required: true },
        { name: 'lang', required: false },
        { name: 'style' },
      ]),
    ).toEqual({
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The code' },
        lang: { type: 'string' },
        style: { type: 'string' },
      },
      required: ['code'],
    })
  })

  it('no arguments -> empty properties and no required key', () => {
    expect(promptArgsToSchema([])).toEqual({ type: 'object', properties: {} })
    expect(promptArgsToSchema(undefined)).toEqual({ type: 'object', properties: {} })
  })

  it('round-trips through lintJsonSchema with no issues', () => {
    expect(lintJsonSchema(promptArgsToSchema([{ name: 'a', description: 'd', required: true }, { name: 'b' }]))).toEqual([])
    expect(lintJsonSchema(promptArgsToSchema([]))).toEqual([])
  })
})

describe('parsePromptArguments', () => {
  it('keeps well-formed entries and drops junk and duplicates', () => {
    expect(
      parsePromptArguments([
        { name: 'a', description: 'x', required: true },
        { name: 'a' },
        { name: '' },
        { name: 5 },
        null,
        'str',
        { name: 'b', description: 3, required: 'yes' },
      ]),
    ).toEqual([{ name: 'a', description: 'x', required: true }, { name: 'b' }])
    expect(parsePromptArguments(undefined)).toEqual([])
    expect(parsePromptArguments({})).toEqual([])
  })
})

describe('filterPrompts', () => {
  const prompts = [
    { name: 'summarize', description: 'Make it short' },
    { name: 'translate', title: 'Translator' },
    { name: 'x' },
  ]
  it('matches name, title and description case-insensitively', () => {
    expect(filterPrompts(prompts, 'SUMM').map((p) => p.name)).toEqual(['summarize'])
    expect(filterPrompts(prompts, 'translator').map((p) => p.name)).toEqual(['translate'])
    expect(filterPrompts(prompts, 'short').map((p) => p.name)).toEqual(['summarize'])
  })
  it('an empty or blank query keeps everything', () => {
    expect(filterPrompts(prompts, '  ')).toHaveLength(3)
  })
  it('returns [] when nothing matches', () => {
    expect(filterPrompts(prompts, 'zzz')).toEqual([])
  })
})

describe('buildPromptArguments', () => {
  const schema = promptArgsToSchema([{ name: 'code', required: true }, { name: 'lang' }])

  it('returns string arguments and omits blank optional ones', () => {
    const r = buildPromptArguments(schema, { code: 'print(1)', lang: '' })
    expect(r).toEqual({ ok: true, arguments: { code: 'print(1)' } })
  })

  it('reports a missing or blank required argument as Required', () => {
    expect(buildPromptArguments(schema, initialFormValue(schema))).toEqual({
      ok: false,
      errors: [{ path: 'code', message: 'Required' }],
    })
    expect(buildPromptArguments(schema, { code: '' })).toEqual({
      ok: false,
      errors: [{ path: 'code', message: 'Required' }],
    })
  })

  it('does not duplicate the Required error', () => {
    const r = buildPromptArguments(schema, {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.filter((e) => e.path === 'code')).toHaveLength(1)
  })

  it('a prompt without arguments yields an empty argument object', () => {
    expect(buildPromptArguments(promptArgsToSchema([]), {})).toEqual({ ok: true, arguments: {} })
  })
})

describe('promptMessages', () => {
  it('maps messages to role + single-block content', () => {
    expect(
      promptMessages({
        messages: [
          { role: 'user', content: { type: 'text', text: 'hi' } },
          { role: 'assistant', content: { type: 'text', text: 'yo' } },
        ],
      }),
    ).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'yo' }] },
    ])
  })
  it('tolerates malformed results', () => {
    expect(promptMessages(null)).toEqual([])
    expect(promptMessages({})).toEqual([])
    expect(promptMessages({ messages: [null, { role: 3 }] })).toEqual([
      { role: 'unknown', content: [] },
      { role: 'unknown', content: [] },
    ])
  })
})
