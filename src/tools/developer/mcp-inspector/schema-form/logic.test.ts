import { describe, it, expect } from 'vitest'
import {
  initialFormValue,
  lintJsonSchema,
  supportsForm,
  toArguments,
  validateAgainstSchema,
  type FieldError,
  type JsonSchema,
} from './logic'

const errorsOf = (schema: JsonSchema, value: unknown): FieldError[] => {
  const r = toArguments(schema, value)
  if (r.ok) throw new Error('expected errors')
  return r.errors
}
const argsOf = (schema: JsonSchema, value: unknown): Record<string, unknown> => {
  const r = toArguments(schema, value)
  if (!r.ok) throw new Error(`unexpected errors: ${JSON.stringify(r.errors)}`)
  return r.arguments
}

describe('supportsForm', () => {
  it('accepts object schemas', () => {
    expect(supportsForm({ type: 'object', properties: { a: { type: 'string' } } })).toEqual({ ok: true })
    expect(supportsForm({ type: 'object' })).toEqual({ ok: true })
    expect(supportsForm({ type: 'object', properties: {} })).toEqual({ ok: true })
    expect(supportsForm({ properties: { a: { type: 'string' } } })).toEqual({ ok: true })
  })

  it('rejects non-object roots', () => {
    expect(supportsForm({ type: 'string' }).ok).toBe(false)
    expect(supportsForm(5).ok).toBe(false)
    expect(supportsForm(null).ok).toBe(false)
    expect(supportsForm([]).ok).toBe(false)
    expect(supportsForm({}).ok).toBe(false)
  })

  it('rejects root combinators and names the keyword', () => {
    const ref = supportsForm({ $ref: '#/x' })
    expect(ref.ok).toBe(false)
    if (!ref.ok) expect(ref.reason).toContain('$ref')
    const one = supportsForm({ oneOf: [{ type: 'object' }, { type: 'object' }] })
    expect(one.ok).toBe(false)
    if (!one.ok) expect(one.reason).toContain('oneOf')
    const any = supportsForm({ type: 'object', anyOf: [] })
    if (!any.ok) expect(any.reason).toContain('anyOf')
    expect(any.ok).toBe(false)
  })

  it('does not reject because a FIELD uses $ref', () => {
    expect(supportsForm({ type: 'object', properties: { a: { $ref: '#/$defs/a' } } })).toEqual({ ok: true })
  })
})

describe('initialFormValue', () => {
  const schema: JsonSchema = {
    type: 'object',
    required: ['s', 'b', 'n', 'i', 'arr', 'obj', 'e'],
    properties: {
      s: { type: 'string' },
      b: { type: 'boolean' },
      n: { type: 'number' },
      i: { type: 'integer' },
      arr: { type: 'array', items: { type: 'string' } },
      obj: { type: 'object', required: ['x'], properties: { x: { type: 'string' }, y: { type: 'number' } } },
      e: { enum: ['a', 'b'] },
      withDefault: { type: 'number', default: 5 },
      optionalPlain: { type: 'string' },
    },
  }

  it('sets required fields to their empty editing value', () => {
    const v = initialFormValue(schema) as Record<string, unknown>
    expect(v.s).toBe('')
    expect(v.b).toBe(false)
    expect(v.arr).toEqual([])
    expect(v.obj).toEqual({ x: '' })
  })

  it('leaves required number/integer unset', () => {
    const v = initialFormValue(schema) as Record<string, unknown>
    expect('n' in v).toBe(false)
    expect('i' in v).toBe(false)
  })

  it('applies defaults to optional fields and leaves other optional fields unset', () => {
    const v = initialFormValue(schema) as Record<string, unknown>
    expect(v.withDefault).toBe(5)
    expect('optionalPlain' in v).toBe(false)
  })

  it('applies a default on a required field too', () => {
    const v = initialFormValue({
      type: 'object',
      required: ['n'],
      properties: { n: { type: 'number', default: 2 } },
    }) as Record<string, unknown>
    expect(v.n).toBe(2)
  })

  it('does not throw on a non-object schema', () => {
    expect(initialFormValue(5 as unknown as JsonSchema)).toEqual({})
  })
})

describe('toArguments – happy path', () => {
  it('converts numbers and integers, keeps booleans', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { count: { type: 'number' }, n: { type: 'integer' }, flag: { type: 'boolean' } },
    }
    expect(argsOf(schema, { count: '3', n: '7', flag: true })).toEqual({ count: 3, n: 7, flag: true })
    expect(argsOf(schema, { count: '2.5e1', n: ' 4 ', flag: false })).toEqual({ count: 25, n: 4, flag: false })
  })

  it('builds nested objects and arrays of objects', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        address: { type: 'object', properties: { zip: { type: 'string' } } },
        items: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'integer' } } },
        },
      },
    }
    expect(
      argsOf(schema, { address: { zip: '123' }, items: [{ name: 'a', qty: '1' }, { name: 'b', qty: '2' }] }),
    ).toEqual({ address: { zip: '123' }, items: [{ name: 'a', qty: 1 }, { name: 'b', qty: 2 }] })
  })

  it('omits unset optional fields (key absent, not empty or null)', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' }, c: { type: 'string' } },
    }
    const out = argsOf(schema, { a: 'x' })
    expect(out).toEqual({ a: 'x' })
    expect('b' in out).toBe(false)
    expect('c' in out).toBe(false)
  })

  it('keeps an included empty string for an optional string', () => {
    expect(argsOf({ type: 'object', properties: { a: { type: 'string' } } }, { a: '' })).toEqual({ a: '' })
  })

  it('handles enum and const with non-string values', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { level: { enum: [1, 2, 3] }, kind: { const: 'fixed' } },
    }
    expect(argsOf(schema, { level: 2, kind: 'fixed' })).toEqual({ level: 2, kind: 'fixed' })
  })

  it('round-trips initialFormValue defaults', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, retries: { type: 'integer', default: 3 } },
    }
    expect(argsOf(schema, { ...(initialFormValue(schema) as object), name: 'x' })).toEqual({ name: 'x', retries: 3 })
  })

  it('does not create a prototype-polluting key from a hostile property name', () => {
    const props = JSON.parse('{"__proto__":{"type":"string"}}') as Record<string, unknown>
    const schema: JsonSchema = { type: 'object', properties: props }
    const value = JSON.parse('{"__proto__":"x"}') as unknown
    const out = argsOf(schema, value)
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.keys(out)).toEqual(['__proto__'])
  })
})

describe('toArguments – errors', () => {
  it('reports a missing required number as Required at its path', () => {
    const schema: JsonSchema = { type: 'object', required: ['count'], properties: { count: { type: 'number' } } }
    expect(errorsOf(schema, {})).toEqual([{ path: 'count', message: 'Required' }])
    expect(errorsOf(schema, { count: '' })).toEqual([{ path: 'count', message: 'Required' }])
  })

  it('reports a missing required string, boolean and enum as Required', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['s', 'e'],
      properties: { s: { type: 'string' }, e: { enum: ['a'] } },
    }
    expect(errorsOf(schema, {})).toEqual([
      { path: 's', message: 'Required' },
      { path: 'e', message: 'Required' },
    ])
  })

  it('rejects fractional integers and non-numbers', () => {
    const schema: JsonSchema = { type: 'object', properties: { i: { type: 'integer' }, n: { type: 'number' } } }
    expect(errorsOf(schema, { i: '1.5' })).toEqual([{ path: 'i', message: 'Must be an integer' }])
    expect(errorsOf(schema, { n: 'abc' })).toEqual([{ path: 'n', message: 'Must be a number' }])
    expect(errorsOf(schema, { n: '1e999' })).toEqual([{ path: 'n', message: 'Must be a number' }])
    expect(errorsOf(schema, { n: '0x10' })).toEqual([{ path: 'n', message: 'Must be a number' }])
  })

  it('includes the bound in minimum/maximum messages', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { n: { type: 'number', minimum: 5, maximum: 10 } },
    }
    const low = errorsOf(schema, { n: '4' })
    expect(low).toHaveLength(1)
    expect(low[0].path).toBe('n')
    expect(low[0].message).toContain('5')
    const high = errorsOf(schema, { n: '11' })
    expect(high[0].message).toContain('10')
    expect(argsOf(schema, { n: '5' })).toEqual({ n: 5 })
    expect(argsOf(schema, { n: '10' })).toEqual({ n: 10 })
  })

  it('checks minLength, maxLength and pattern', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        a: { type: 'string', minLength: 3 },
        b: { type: 'string', maxLength: 2 },
        c: { type: 'string', pattern: '^[a-z]+$' },
      },
    }
    const errs = errorsOf(schema, { a: 'ab', b: 'abc', c: 'ABC' })
    expect(errs.map((e) => e.path)).toEqual(['a', 'b', 'c'])
    expect(errs[0].message).toContain('3')
    expect(errs[1].message).toContain('2')
    expect(errs[2].message).toContain('^[a-z]+$')
  })

  it('counts length in code points, not UTF-16 units', () => {
    const schema: JsonSchema = { type: 'object', properties: { a: { type: 'string', maxLength: 1 } } }
    expect(argsOf(schema, { a: '😀' })).toEqual({ a: '😀' })
  })

  it('does not throw on an invalid pattern in the schema', () => {
    const schema: JsonSchema = { type: 'object', properties: { a: { type: 'string', pattern: '(' } } }
    expect(argsOf(schema, { a: 'x' })).toEqual({ a: 'x' })
  })

  it('rejects an enum value outside the enum', () => {
    const schema: JsonSchema = { type: 'object', properties: { e: { enum: ['a', 'b'] } } }
    const errs = errorsOf(schema, { e: 'z' })
    expect(errs[0].path).toBe('e')
    expect(errs[0].message).toContain('a')
    expect(errs[0].message).toContain('b')
  })

  it('checks minItems and maxItems', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        lo: { type: 'array', items: { type: 'string' }, minItems: 2 },
        hi: { type: 'array', items: { type: 'string' }, maxItems: 1 },
      },
    }
    const errs = errorsOf(schema, { lo: ['a'], hi: ['a', 'b'] })
    expect(errs).toEqual([
      { path: 'lo', message: 'Must have at least 2 items' },
      { path: 'hi', message: 'Must have at most 1 items' },
    ])
  })

  it('reports nested and array paths', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        address: { type: 'object', required: ['zip'], properties: { zip: { type: 'string' } } },
        items: {
          type: 'array',
          items: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        },
      },
    }
    const errs = errorsOf(schema, { address: {}, items: [{ name: 'ok' }, {}] })
    expect(errs).toEqual([
      { path: 'address.zip', message: 'Required' },
      { path: 'items[1].name', message: 'Required' },
    ])
  })

  it('returns every error together', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['a', 'b', 'c'],
      properties: { a: { type: 'string' }, b: { type: 'number' }, c: { type: 'integer' } },
    }
    const errs = errorsOf(schema, { a: undefined, b: 'x', c: '1.5' })
    expect(errs.map((e) => e.path)).toEqual(['a', 'b', 'c'])
  })
})

describe('toArguments – nullable', () => {
  const variants: [string, JsonSchema][] = [
    ['type array', { type: 'object', properties: { a: { type: ['string', 'null'] } } }],
    ['anyOf', { type: 'object', properties: { a: { anyOf: [{ type: 'string' }, { type: 'null' }] } } }],
    ['oneOf, null first', { type: 'object', properties: { a: { oneOf: [{ type: 'null' }, { type: 'string' }] } } }],
  ]
  for (const [name, schema] of variants) {
    it(`returns an explicit null (${name})`, () => {
      expect(argsOf(schema, { a: null })).toEqual({ a: null })
    })
    it(`still validates the non-null branch (${name})`, () => {
      expect(argsOf(schema, { a: 'x' })).toEqual({ a: 'x' })
    })
    it(`omits the key when unset (${name})`, () => {
      const out = argsOf(schema, {})
      expect('a' in out).toBe(false)
    })
  }

  it('rejects null for a non-nullable field', () => {
    const schema: JsonSchema = { type: 'object', properties: { a: { type: 'string' } } }
    expect(errorsOf(schema, { a: null })[0]).toEqual({ path: 'a', message: 'Must be a string' })
  })

  it('applies the inner constraints of a nullable number', () => {
    const schema: JsonSchema = { type: 'object', properties: { n: { type: ['integer', 'null'], minimum: 1 } } }
    expect(errorsOf(schema, { n: '0' })[0].path).toBe('n')
    expect(argsOf(schema, { n: null })).toEqual({ n: null })
  })

  it('a required nullable field still requires a value (null counts)', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['a'],
      properties: { a: { type: ['string', 'null'] } },
    }
    expect(argsOf(schema, { a: null })).toEqual({ a: null })
  })
})

describe('toArguments – unsupported fields fall back to JSON text', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      ref: { $ref: '#/$defs/thing' },
      either: { oneOf: [{ type: 'object' }, { type: 'object', properties: { x: { type: 'string' } } }] },
      map: { type: 'object', patternProperties: { '^x-': { type: 'string' } } },
      plain: { type: 'string' },
    },
  }

  it('parses valid JSON text into the arguments', () => {
    expect(argsOf(schema, { ref: '{"a":1}', either: '[1,2]', map: '{"x-a":"b"}', plain: 'ok' })).toEqual({
      ref: { a: 1 },
      either: [1, 2],
      map: { 'x-a': 'b' },
      plain: 'ok',
    })
  })

  it('reports invalid JSON at the field path without disturbing other fields', () => {
    const errs = errorsOf(schema, { ref: '{oops', plain: 'ok' })
    expect(errs).toHaveLength(1)
    expect(errs[0].path).toBe('ref')
    expect(errs[0].message.startsWith('Invalid JSON: ')).toBe(true)
  })

  it('reports JSON errors inside array items by index', () => {
    const s: JsonSchema = { type: 'object', properties: { xs: { type: 'array', items: { $ref: '#/x' } } } }
    const errs = errorsOf(s, { xs: ['1', '{'] })
    expect(errs).toHaveLength(1)
    expect(errs[0].path).toBe('xs[1]')
  })

  it('treats a required raw field with empty text as Required', () => {
    const s: JsonSchema = { type: 'object', required: ['r'], properties: { r: { $ref: '#/x' } } }
    expect(errorsOf(s, { r: '  ' })).toEqual([{ path: 'r', message: 'Required' }])
  })

  it('omits an unset optional raw field', () => {
    expect(argsOf(schema, {})).toEqual({})
  })
})

describe('validateAgainstSchema', () => {
  const paths = (s: JsonSchema, v: unknown) => validateAgainstSchema(s, v).map((e) => e.path)

  it('returns [] for a valid value', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string', minLength: 1 }, b: { type: 'array', items: { type: 'integer' } } },
    }
    expect(validateAgainstSchema(schema, { a: 'x', b: [1, 2] })).toEqual([])
  })

  it('checks type', () => {
    expect(paths({ type: 'string' }, 5)).toEqual([''])
    expect(paths({ type: 'integer' }, 1.5)).toEqual([''])
    expect(paths({ type: 'number' }, 1.5)).toEqual([])
    expect(paths({ type: ['string', 'null'] }, null)).toEqual([])
    expect(paths({ type: 'object' }, [])).toEqual([''])
    expect(paths({ type: 'array' }, {})).toEqual([''])
    expect(paths({ type: 'boolean' }, 'true')).toEqual([''])
  })

  it('checks required with the property path', () => {
    const errs = validateAgainstSchema({ type: 'object', required: ['a', 'b'] }, { a: 1 })
    expect(errs).toEqual([{ path: 'b', message: 'Required' }])
  })

  it('checks enum and const with deep equality', () => {
    expect(paths({ enum: [{ a: 1 }, 2] }, { a: 1 })).toEqual([])
    expect(paths({ enum: ['a'] }, 'b')).toEqual([''])
    expect(paths({ const: [1, 2] }, [1, 2])).toEqual([])
    expect(paths({ const: 1 }, 2)).toEqual([''])
  })

  it('checks numeric bounds including exclusive ones', () => {
    expect(paths({ minimum: 1 }, 0)).toEqual([''])
    expect(paths({ maximum: 1 }, 2)).toEqual([''])
    expect(paths({ exclusiveMinimum: 1 }, 1)).toEqual([''])
    expect(paths({ exclusiveMaximum: 1 }, 1)).toEqual([''])
    expect(paths({ minimum: 1, maximum: 3 }, 2)).toEqual([])
  })

  it('checks string length and pattern', () => {
    expect(paths({ minLength: 2 }, 'a')).toEqual([''])
    expect(paths({ maxLength: 1 }, 'ab')).toEqual([''])
    expect(paths({ pattern: '^a' }, 'ba')).toEqual([''])
    expect(paths({ pattern: '^a' }, 'ab')).toEqual([])
  })

  it('checks array size and items with index paths', () => {
    const schema: JsonSchema = { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } }
    expect(paths(schema, [])).toEqual([''])
    expect(paths(schema, ['a', 'b', 'c'])).toEqual([''])
    expect(paths(schema, ['a', 1])).toEqual(['[1]'])
  })

  it('checks nested properties with dotted paths', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'object', properties: { b: { type: 'array', items: { type: 'number' } } } } },
    }
    expect(paths(schema, { a: { b: [1, 'x'] } })).toEqual(['a.b[1]'])
  })

  it('ignores unknown keywords and unknown type names', () => {
    expect(validateAgainstSchema({ type: 'string', 'x-foo': 1, format: 'email', $comment: 'c' }, 'hello')).toEqual([])
    expect(validateAgainstSchema({ type: 'frobnicate' }, 5)).toEqual([])
  })

  it('yields [] for schemas it cannot evaluate, and never throws', () => {
    expect(validateAgainstSchema(null as unknown as JsonSchema, 1)).toEqual([])
    expect(validateAgainstSchema(5 as unknown as JsonSchema, 1)).toEqual([])
    expect(validateAgainstSchema({ $ref: '#/nope' }, 1)).toEqual([])
    expect(validateAgainstSchema({ properties: 5, required: 'a', items: 3 } as JsonSchema, { a: 1 })).toEqual([])
    expect(validateAgainstSchema({ pattern: '(' }, 'x')).toEqual([])
  })

  it('does not overflow on a circular schema', () => {
    const schema: Record<string, unknown> = { type: 'object' }
    schema.properties = { self: schema }
    const value: Record<string, unknown> = {}
    value.self = value
    expect(() => validateAgainstSchema(schema, value)).not.toThrow()
  })
})

describe('lintJsonSchema', () => {
  const lint = (s: unknown) => lintJsonSchema(s)
  const at = (s: unknown, path: string) => lint(s).filter((i) => i.path === path)

  it('accepts a valid schema', () => {
    expect(lint({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })).toEqual([])
    expect(lint({})).toEqual([])
    expect(lint(true)).toEqual([])
  })

  it('flags a non-schema root at path ""', () => {
    expect(at(5, '')).toHaveLength(1)
    expect(at(null, '')).toHaveLength(1)
    expect(at([], '')).toHaveLength(1)
    expect(at('x', '')).toHaveLength(1)
  })

  it('flags bad type values', () => {
    expect(at({ type: 'strng' }, 'type')).toHaveLength(1)
    expect(at({ type: ['string', 'nope'] }, 'type')).toHaveLength(1)
    expect(at({ type: 5 }, 'type')).toHaveLength(1)
    expect(lint({ type: ['string', 'null'] })).toEqual([])
  })

  it('flags non-object properties', () => {
    expect(at({ properties: 5 }, 'properties')).toHaveLength(1)
    expect(at({ properties: [] }, 'properties')).toHaveLength(1)
  })

  it('flags malformed required', () => {
    expect(at({ required: 'a' }, 'required')).toHaveLength(1)
    expect(at({ required: [1] }, 'required')).toHaveLength(1)
  })

  it('flags required names missing from properties', () => {
    const issues = lint({ type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'ghost'] })
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('required')
    expect(issues[0].message).toContain('required')
    expect(issues[0].message).toContain('ghost')
  })

  it('does not flag required names when properties may come from elsewhere', () => {
    expect(lint({ required: ['a'], allOf: [{ properties: { a: {} } }] })).toEqual([])
    expect(lint({ required: ['a'], $ref: '#/x' })).toEqual([])
    expect(lint({ required: ['a'], additionalProperties: { type: 'string' } })).toEqual([])
  })

  it('flags bad enum and numeric keywords', () => {
    expect(at({ enum: 'x' }, 'enum')).toHaveLength(1)
    expect(at({ enum: [] }, 'enum')).toHaveLength(1)
    expect(at({ minimum: '1' }, 'minimum')).toHaveLength(1)
    expect(at({ maxLength: -1 }, 'maxLength')).toHaveLength(1)
    expect(at({ minItems: 1.5 }, 'minItems')).toHaveLength(1)
  })

  it('flags contradictory bounds and invalid patterns', () => {
    expect(at({ minimum: 5, maximum: 1 }, 'minimum')).toHaveLength(1)
    expect(at({ pattern: '(' }, 'pattern')).toHaveLength(1)
    expect(at({ pattern: 3 }, 'pattern')).toHaveLength(1)
  })

  it('reports nested paths', () => {
    expect(at({ type: 'object', properties: { a: { type: 'strng' } } }, 'properties.a.type')).toHaveLength(1)
    expect(at({ type: 'array', items: { type: 'bad' } }, 'items.type')).toHaveLength(1)
    expect(at({ anyOf: [{ type: 'string' }, { type: 'bad' }] }, 'anyOf[1].type')).toHaveLength(1)
    expect(at({ anyOf: [] }, 'anyOf')).toHaveLength(1)
  })

  it('never throws on circular input and reports it', () => {
    const schema: Record<string, unknown> = { type: 'object' }
    schema.properties = { self: schema }
    let issues: FieldError[] = []
    expect(() => {
      issues = lint(schema)
    }).not.toThrow()
    expect(issues.length).toBeGreaterThan(0)
    const arr: unknown[] = []
    arr.push(arr)
    expect(() => lint({ enum: arr, anyOf: arr })).not.toThrow()
  })

  it('does not throw on hostile shapes', () => {
    const hostile = JSON.parse('{"properties":{"__proto__":{"type":"nope"}}}') as unknown
    expect(() => lint(hostile)).not.toThrow()
    expect(lint(hostile).length).toBeGreaterThan(0)
  })
})
