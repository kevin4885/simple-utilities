// Pure schema-to-form logic for the MCP Inspector (contract C5). No React, no side effects.
//
// Editing-state model (what `FormValue` holds, owned by the caller and opaque to it):
//   object  -> Record<string, field value>; an ABSENT key means "unset" (optional field not included)
//   string  -> string                       number / integer -> string (input text) or a number (defaults)
//   boolean -> boolean                      enum / const     -> the actual JSON value
//   array   -> field value[]                nullable         -> `null` when the null toggle is on
//   raw     -> string (JSON text) for any field the form cannot represent

export type JsonSchema = Record<string, unknown>
export type FormValue = unknown
export interface FieldError {
  path: string // 'name', 'address.zip', 'items[0].name'; '' = root
  message: string
}

// ── small utilities ──────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Assign as an OWN property even for keys like `__proto__` (server-supplied schemas are untrusted). */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

export function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key
}

export function indexPath(base: string, index: number): string {
  return `${base}[${index}]`
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  return deepEqual(a, b)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => hasOwn(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

function describeJson(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'u')
  } catch {
    try {
      return new RegExp(pattern)
    } catch {
      return null
    }
  }
}

function propsOf(schema: JsonSchema): [string, unknown][] {
  return isRecord(schema.properties) ? Object.entries(schema.properties) : []
}

function requiredSet(schema: JsonSchema): Set<string> {
  return new Set(Array.isArray(schema.required) ? schema.required.filter((k): k is string => typeof k === 'string') : [])
}

export function enumOptions(schema: JsonSchema): unknown[] {
  return Array.isArray(schema.enum) ? schema.enum : []
}

export function optionLabel(v: unknown): string {
  return describeJson(v)
}

// ── supportsForm ─────────────────────────────────────────────────────────────

const ROOT_BLOCKERS = ['$ref', 'anyOf', 'oneOf', 'allOf']

export function supportsForm(schema: unknown): { ok: true } | { ok: false; reason: string } {
  if (!isRecord(schema)) return { ok: false, reason: 'Schema is not an object' }
  for (const k of ROOT_BLOCKERS) {
    if (hasOwn(schema, k)) {
      return { ok: false, reason: `Root schema uses "${k}", which the form cannot represent` }
    }
  }
  const t = schema.type
  if (t === 'object' || (Array.isArray(t) && t.length === 1 && t[0] === 'object')) return { ok: true }
  if (t === undefined && isRecord(schema.properties)) return { ok: true }
  if (t === undefined) return { ok: false, reason: 'Root schema has no "type": "object"' }
  return { ok: false, reason: `Root schema type is ${describeJson(t)}, expected "object"` }
}

// ── field description ────────────────────────────────────────────────────────

export type FieldKind = 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'const' | 'array' | 'object' | 'raw'

export interface FieldDesc {
  kind: FieldKind
  nullable: boolean
  /** The (non-null branch of the) schema the constraints are read from. */
  schema: JsonSchema
  title?: string
  description?: string
  hasDefault: boolean
  defaultValue: unknown
}

const UNSUPPORTED_KEYWORDS = [
  '$ref',
  '$dynamicRef',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'patternProperties',
  'propertyNames',
  'dependentSchemas',
  'dependencies',
  'prefixItems',
]

function meta(outer: JsonSchema, inner: JsonSchema) {
  const useOuterDefault = hasOwn(outer, 'default')
  return {
    title: asString(outer.title) ?? asString(inner.title),
    description: asString(outer.description) ?? asString(inner.description),
    hasDefault: useOuterDefault || hasOwn(inner, 'default'),
    defaultValue: useOuterDefault ? outer.default : inner.default,
  }
}

const isNullSchema = (s: unknown): boolean => isRecord(s) && s.type === 'null'

/** Classify a field schema into the kind of control that edits it. Never throws. */
export function describeField(input: unknown): FieldDesc {
  const schema: JsonSchema = isRecord(input) ? input : {}
  const m = meta(schema, schema)
  const raw: FieldDesc = { kind: 'raw', nullable: false, schema, ...m }
  if (!isRecord(input)) return raw
  if (UNSUPPORTED_KEYWORDS.some((k) => hasOwn(schema, k))) return raw

  const combo = hasOwn(schema, 'anyOf') ? 'anyOf' : hasOwn(schema, 'oneOf') ? 'oneOf' : null
  if (combo) {
    const branches = schema[combo]
    if (Array.isArray(branches) && branches.length === 2) {
      const nullIdx = branches.findIndex(isNullSchema)
      const inner = nullIdx === -1 ? undefined : branches[1 - nullIdx]
      if (isRecord(inner) && !isNullSchema(inner)) {
        const d = describeField(inner)
        if (d.kind !== 'raw') return { ...d, nullable: true, ...meta(schema, inner) }
      }
    }
    return raw
  }

  let nullable = false
  let t: string | undefined
  const rawType = schema.type
  if (Array.isArray(rawType)) {
    const nonNull = rawType.filter((x) => x !== 'null')
    nullable = nonNull.length !== rawType.length
    if (nonNull.length !== 1 || typeof nonNull[0] !== 'string') return raw
    t = nonNull[0]
  } else if (typeof rawType === 'string') {
    t = rawType
  } else if (rawType !== undefined) {
    return raw
  }

  const done = (kind: FieldKind): FieldDesc => ({ kind, nullable, schema, ...m })
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return done('enum')
  if (hasOwn(schema, 'const')) return done('const')

  switch (t) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
      return done(t)
    case 'array':
      return Array.isArray(schema.items) ? raw : done('array')
    default:
      break
  }
  if (t === 'object' || (t === undefined && isRecord(schema.properties))) {
    const hasProps = isRecord(schema.properties) && Object.keys(schema.properties).length > 0
    return hasProps && !isRecord(schema.additionalProperties) ? done('object') : raw
  }
  return raw
}

// ── initial values ───────────────────────────────────────────────────────────

/** A freshly "included" value for a field (what an optional field gets when ticked, a new array row, ...). */
export function blankValue(desc: FieldDesc): unknown {
  switch (desc.kind) {
    case 'string':
    case 'number':
    case 'integer':
    case 'raw':
      return ''
    case 'boolean':
      return false
    case 'enum':
      return enumOptions(desc.schema)[0]
    case 'const':
      return desc.schema.const
    case 'array':
      return []
    case 'object':
      return initialObject(desc.schema)
  }
}

function fromDefault(desc: FieldDesc, d: unknown): unknown {
  if (d === null && desc.nullable) return null
  switch (desc.kind) {
    case 'string':
      return typeof d === 'string' ? d : blankValue(desc)
    case 'number':
    case 'integer':
      return typeof d === 'number' || typeof d === 'string' ? d : blankValue(desc)
    case 'boolean':
      return typeof d === 'boolean' ? d : blankValue(desc)
    case 'enum':
    case 'const':
      return d
    case 'array': {
      if (!Array.isArray(d)) return []
      const item = describeField(desc.schema.items)
      return d.map((x) => fromDefault(item, x))
    }
    case 'object': {
      const base = initialObject(desc.schema)
      if (!isRecord(d)) return base
      for (const [k, sub] of propsOf(desc.schema)) {
        if (hasOwn(d, k)) setOwn(base, k, fromDefault(describeField(sub), d[k]))
      }
      return base
    }
    case 'raw':
      return d === undefined ? '' : (JSON.stringify(d, null, 2) ?? '')
  }
}

/** Value a field gets when the user ticks its include checkbox: its default, else a blank. */
export function defaultFieldValue(desc: FieldDesc): unknown {
  return desc.hasDefault ? fromDefault(desc, desc.defaultValue) : blankValue(desc)
}

const UNSET_WHEN_REQUIRED: FieldKind[] = ['number', 'integer', 'enum']

function initialFieldValue(desc: FieldDesc, required: boolean): unknown {
  if (desc.hasDefault) return fromDefault(desc, desc.defaultValue)
  if (!required) return undefined
  if (UNSET_WHEN_REQUIRED.includes(desc.kind)) return undefined
  return blankValue(desc)
}

function initialObject(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const required = requiredSet(schema)
  for (const [key, sub] of propsOf(schema)) {
    const v = initialFieldValue(describeField(sub), required.has(key))
    if (v !== undefined) setOwn(out, key, v)
  }
  return out
}

export function initialFormValue(schema: JsonSchema): FormValue {
  return initialObject(isRecord(schema) ? schema : {})
}

// ── shared constraint checks (used by toArguments and validateAgainstSchema) ──

function stringIssues(schema: JsonSchema, s: string): string[] {
  const out: string[] = []
  const len = Array.from(s).length
  if (typeof schema.minLength === 'number' && len < schema.minLength) {
    out.push(`Must be at least ${schema.minLength} characters`)
  }
  if (typeof schema.maxLength === 'number' && len > schema.maxLength) {
    out.push(`Must be at most ${schema.maxLength} characters`)
  }
  if (typeof schema.pattern === 'string') {
    const re = compilePattern(schema.pattern)
    if (re && !re.test(s)) out.push(`Must match pattern ${schema.pattern}`)
  }
  return out
}

function numberIssues(schema: JsonSchema, n: number): string[] {
  const out: string[] = []
  if (typeof schema.minimum === 'number' && n < schema.minimum) out.push(`Must be at least ${schema.minimum}`)
  if (typeof schema.maximum === 'number' && n > schema.maximum) out.push(`Must be at most ${schema.maximum}`)
  if (typeof schema.exclusiveMinimum === 'number' && n <= schema.exclusiveMinimum) {
    out.push(`Must be greater than ${schema.exclusiveMinimum}`)
  }
  if (typeof schema.exclusiveMaximum === 'number' && n >= schema.exclusiveMaximum) {
    out.push(`Must be less than ${schema.exclusiveMaximum}`)
  }
  return out
}

function arrayLengthIssues(schema: JsonSchema, length: number): string[] {
  const out: string[] = []
  if (typeof schema.minItems === 'number' && length < schema.minItems) {
    out.push(`Must have at least ${schema.minItems} items`)
  }
  if (typeof schema.maxItems === 'number' && length > schema.maxItems) {
    out.push(`Must have at most ${schema.maxItems} items`)
  }
  return out
}

const enumMessage = (options: unknown[]): string => `Must be one of: ${options.map(describeJson).join(', ')}`

// ── toArguments ──────────────────────────────────────────────────────────────

type Conv = { ok: true; value: unknown } | { ok: false }

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

function fail(errors: FieldError[], path: string, ...messages: string[]): Conv {
  for (const message of messages) errors.push({ path, message })
  return { ok: false }
}

function convertNumber(desc: FieldDesc, v: unknown, path: string, errors: FieldError[]): Conv {
  let n: number
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return fail(errors, path, 'Must be a number')
    n = v
  } else if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return fail(errors, path, 'Required')
    if (!NUMERIC.test(t)) return fail(errors, path, 'Must be a number')
    n = Number(t)
    if (!Number.isFinite(n)) return fail(errors, path, 'Must be a number')
  } else {
    return fail(errors, path, 'Must be a number')
  }
  if (desc.kind === 'integer' && !Number.isInteger(n)) return fail(errors, path, 'Must be an integer')
  const issues = numberIssues(desc.schema, n)
  return issues.length ? fail(errors, path, ...issues) : { ok: true, value: n }
}

function convertValue(desc: FieldDesc, v: unknown, path: string, errors: FieldError[]): Conv {
  if (v === null && desc.nullable) return { ok: true, value: null }
  switch (desc.kind) {
    case 'string': {
      if (typeof v !== 'string') return fail(errors, path, 'Must be a string')
      const issues = stringIssues(desc.schema, v)
      return issues.length ? fail(errors, path, ...issues) : { ok: true, value: v }
    }
    case 'number':
    case 'integer':
      return convertNumber(desc, v, path, errors)
    case 'boolean':
      return typeof v === 'boolean' ? { ok: true, value: v } : fail(errors, path, 'Must be true or false')
    case 'enum': {
      const options = enumOptions(desc.schema)
      return options.some((o) => deepEqual(o, v)) ? { ok: true, value: v } : fail(errors, path, enumMessage(options))
    }
    case 'const':
      return deepEqual(desc.schema.const, v)
        ? { ok: true, value: desc.schema.const }
        : fail(errors, path, `Must equal ${describeJson(desc.schema.const)}`)
    case 'array': {
      if (!Array.isArray(v)) return fail(errors, path, 'Must be a list')
      const before = errors.length
      for (const message of arrayLengthIssues(desc.schema, v.length)) errors.push({ path, message })
      const item = describeField(desc.schema.items)
      const out: unknown[] = []
      v.forEach((x, i) => {
        const r = convertValue(item, x, indexPath(path, i), errors)
        if (r.ok) out.push(r.value)
      })
      return errors.length === before ? { ok: true, value: out } : { ok: false }
    }
    case 'object': {
      if (!isRecord(v)) return fail(errors, path, 'Must be an object')
      const before = errors.length
      const out = convertObject(desc.schema, v, path, errors)
      return errors.length === before ? { ok: true, value: out } : { ok: false }
    }
    case 'raw': {
      if (typeof v !== 'string') return fail(errors, path, 'Invalid JSON: expected text')
      if (v.trim() === '') return fail(errors, path, 'Required')
      try {
        return { ok: true, value: JSON.parse(v) as unknown }
      } catch (e) {
        return fail(errors, path, `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}

function convertObject(
  schema: JsonSchema,
  value: unknown,
  path: string,
  errors: FieldError[],
): Record<string, unknown> {
  const rec = isRecord(value) ? value : {}
  const required = requiredSet(schema)
  const out: Record<string, unknown> = {}
  for (const [key, sub] of propsOf(schema)) {
    const p = joinPath(path, key)
    const v = hasOwn(rec, key) ? rec[key] : undefined
    if (v === undefined) {
      if (required.has(key)) errors.push({ path: p, message: 'Required' })
      continue
    }
    const r = convertValue(describeField(sub), v, p, errors)
    if (r.ok) setOwn(out, key, r.value)
  }
  return out
}

export function toArguments(
  schema: JsonSchema,
  value: FormValue,
): { ok: true; arguments: Record<string, unknown> } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = []
  const args = convertObject(isRecord(schema) ? schema : {}, value, '', errors)
  return errors.length ? { ok: false, errors } : { ok: true, arguments: args }
}

// ── validateAgainstSchema ────────────────────────────────────────────────────

const MAX_VALIDATE_DEPTH = 64

function typeName(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function typeMatches(t: string, v: unknown): boolean {
  switch (t) {
    case 'string':
      return typeof v === 'string'
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v)
    case 'boolean':
      return typeof v === 'boolean'
    case 'null':
      return v === null
    case 'array':
      return Array.isArray(v)
    case 'object':
      return isRecord(v)
    default:
      return true // unknown type name: cannot evaluate, so do not reject
  }
}

function validateNode(schema: unknown, value: unknown, path: string, errors: FieldError[], depth: number): void {
  if (depth > MAX_VALIDATE_DEPTH || !isRecord(schema)) return
  const add = (message: string, p = path) => errors.push({ path: p, message })

  const types = typeof schema.type === 'string'
    ? [schema.type]
    : Array.isArray(schema.type)
      ? schema.type.filter((t): t is string => typeof t === 'string')
      : []
  if (types.length > 0 && !types.some((t) => typeMatches(t, value))) {
    add(`Expected ${types.join(' or ')}, got ${typeName(value)}`)
    return
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((o) => deepEqual(o, value))) {
    add(enumMessage(schema.enum))
  }
  if (hasOwn(schema, 'const') && !deepEqual(schema.const, value)) {
    add(`Must equal ${describeJson(schema.const)}`)
  }

  if (typeof value === 'string') {
    stringIssues(schema, value).forEach((m) => add(m))
  } else if (typeof value === 'number') {
    numberIssues(schema, value).forEach((m) => add(m))
  } else if (Array.isArray(value)) {
    arrayLengthIssues(schema, value.length).forEach((m) => add(m))
    if (isRecord(schema.items)) {
      value.forEach((x, i) => validateNode(schema.items, x, indexPath(path, i), errors, depth + 1))
    } else if (Array.isArray(schema.items)) {
      const tuple = schema.items
      value.forEach((x, i) => {
        if (i < tuple.length) validateNode(tuple[i], x, indexPath(path, i), errors, depth + 1)
      })
    }
  } else if (isRecord(value)) {
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) {
        if (typeof k === 'string' && !hasOwn(value, k)) add('Required', joinPath(path, k))
      }
    }
    for (const [k, sub] of propsOf(schema)) {
      if (hasOwn(value, k)) validateNode(sub, value[k], joinPath(path, k), errors, depth + 1)
    }
  }
}

/** Evaluates a documented keyword subset against a JSON value. `[]` = valid. Never throws. */
export function validateAgainstSchema(schema: JsonSchema, value: unknown): FieldError[] {
  const errors: FieldError[] = []
  try {
    validateNode(schema, value, '', errors, 0)
  } catch {
    return []
  }
  return errors
}

// ── lintJsonSchema ───────────────────────────────────────────────────────────

const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])
const NUMBER_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']
const COUNT_KEYWORDS = ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties']
const SCHEMA_MAP_KEYWORDS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
const SCHEMA_KEYWORDS = [
  'additionalProperties',
  'additionalItems',
  'unevaluatedProperties',
  'unevaluatedItems',
  'not',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
]
const SCHEMA_LIST_KEYWORDS = ['anyOf', 'oneOf', 'allOf', 'prefixItems']
// Keywords that can define properties outside `properties`, so a `required` entry may be legitimate.
const OPEN_PROPERTY_KEYWORDS = ['$ref', 'allOf', 'anyOf', 'oneOf', 'if', 'patternProperties', 'dependentSchemas', 'unevaluatedProperties']
const MAX_LINT_DEPTH = 100

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function lintNode(node: unknown, path: string, issues: FieldError[], ancestors: object[], depth: number): void {
  if (typeof node === 'boolean') return
  if (!isRecord(node)) {
    issues.push({ path, message: 'Schema must be an object or a boolean' })
    return
  }
  if (ancestors.includes(node)) {
    issues.push({ path, message: 'Circular reference in schema' })
    return
  }
  if (depth > MAX_LINT_DEPTH) {
    issues.push({ path, message: 'Schema is nested too deeply' })
    return
  }
  ancestors.push(node)
  try {
    const at = (key: string) => joinPath(path, key)
    const add = (key: string, message: string) => issues.push({ path: at(key), message })

    if (hasOwn(node, 'type')) {
      const t = node.type
      const bad = Array.isArray(t)
        ? t.length === 0 || t.some((x) => typeof x !== 'string' || !SCHEMA_TYPES.has(x))
        : typeof t !== 'string' || !SCHEMA_TYPES.has(t)
      if (bad) add('type', `Unknown type ${describeJson(t)}; expected one of ${[...SCHEMA_TYPES].join(', ')}`)
    }

    for (const key of SCHEMA_MAP_KEYWORDS) {
      if (!hasOwn(node, key)) continue
      const map = node[key]
      if (!isRecord(map)) {
        add(key, `"${key}" must be an object`)
        continue
      }
      for (const [name, sub] of Object.entries(map)) lintNode(sub, joinPath(at(key), name), issues, ancestors, depth + 1)
    }

    for (const key of SCHEMA_KEYWORDS) {
      if (hasOwn(node, key)) lintNode(node[key], at(key), issues, ancestors, depth + 1)
    }

    for (const key of SCHEMA_LIST_KEYWORDS) {
      if (!hasOwn(node, key)) continue
      const list = node[key]
      if (!Array.isArray(list) || list.length === 0) {
        add(key, `"${key}" must be a non-empty array of schemas`)
        continue
      }
      list.forEach((sub, i) => lintNode(sub, indexPath(at(key), i), issues, ancestors, depth + 1))
    }

    if (hasOwn(node, 'items')) {
      const items = node.items
      if (Array.isArray(items)) {
        items.forEach((sub, i) => lintNode(sub, indexPath(at('items'), i), issues, ancestors, depth + 1))
      } else {
        lintNode(items, at('items'), issues, ancestors, depth + 1)
      }
    }

    if (hasOwn(node, 'required')) {
      const req = node.required
      if (!Array.isArray(req) || req.some((k) => typeof k !== 'string')) {
        add('required', '"required" must be an array of property names')
      } else if (!OPEN_PROPERTY_KEYWORDS.some((k) => hasOwn(node, k)) && !isRecord(node.additionalProperties)) {
        const known = isRecord(node.properties) ? node.properties : {}
        for (const name of req as string[]) {
          if (!hasOwn(known, name)) add('required', `"required" lists "${name}", which is not defined in properties`)
        }
      }
    }

    if (hasOwn(node, 'enum') && (!Array.isArray(node.enum) || node.enum.length === 0)) {
      add('enum', '"enum" must be a non-empty array')
    }

    for (const key of NUMBER_KEYWORDS) {
      if (hasOwn(node, key) && !isFiniteNumber(node[key])) add(key, `"${key}" must be a number`)
    }
    if (hasOwn(node, 'multipleOf') && !(isFiniteNumber(node.multipleOf) && node.multipleOf > 0)) {
      add('multipleOf', '"multipleOf" must be a number greater than 0')
    }
    for (const key of COUNT_KEYWORDS) {
      if (hasOwn(node, key) && !isCount(node[key])) add(key, `"${key}" must be a non-negative integer`)
    }

    const pairs: [string, string][] = [
      ['minimum', 'maximum'],
      ['minLength', 'maxLength'],
      ['minItems', 'maxItems'],
      ['minProperties', 'maxProperties'],
    ]
    for (const [lo, hi] of pairs) {
      if (isFiniteNumber(node[lo]) && isFiniteNumber(node[hi]) && node[lo] > node[hi]) {
        add(lo, `"${lo}" (${node[lo]}) is greater than "${hi}" (${node[hi]})`)
      }
    }

    if (hasOwn(node, 'pattern')) {
      if (typeof node.pattern !== 'string') add('pattern', '"pattern" must be a string')
      else if (!compilePattern(node.pattern)) add('pattern', '"pattern" is not a valid regular expression')
    }
    for (const key of ['$ref', 'title', 'description', 'format']) {
      if (hasOwn(node, key) && typeof node[key] !== 'string') add(key, `"${key}" must be a string`)
    }
  } finally {
    ancestors.pop()
  }
}

/** Structural validity of a JSON Schema document itself. `[]` = fine. Never throws. */
export function lintJsonSchema(schema: unknown): FieldError[] {
  const issues: FieldError[] = []
  try {
    lintNode(schema, '', issues, [], 0)
  } catch {
    issues.push({ path: '', message: 'Schema could not be inspected' })
  }
  return issues
}
