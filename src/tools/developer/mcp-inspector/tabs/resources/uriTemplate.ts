// Pure RFC 6570 subset used by MCP resource templates (no React, no side effects).
// Supported expressions: {var}, {+var}, {#var}, {?a,b}, {&a} with comma-separated variable lists.
// Anything else ({/x} {.x} {;x} {x*} {x:3} ...) is rejected with an error that names it.

export type ExpandResult =
  | { ok: true; uri: string; missing: string[] }
  | { ok: false; error: string }

type Operator = '' | '+' | '#' | '?' | '&'
type TemplatePart = { kind: 'literal'; text: string } | { kind: 'expr'; op: Operator; vars: string[] }
type ParseResult = { ok: true; parts: TemplatePart[] } | { ok: false; error: string }

const SUPPORTED_OPERATORS = new Set(['+', '#', '?', '&'])
// RFC 6570 operators (and reserved future operators) this engine does not implement.
const UNSUPPORTED_OPERATORS = new Set(['.', '/', ';', '=', ',', '!', '@', '|'])
const VAR_NAME_RE = /^[A-Za-z0-9_.%]+$/

function parseTemplate(template: string): ParseResult {
  const parts: TemplatePart[] = []
  let literal = ''
  let i = 0
  while (i < template.length) {
    const c = template[i]
    if (c === '}') return { ok: false, error: `Unmatched '}' at position ${i}` }
    if (c !== '{') {
      literal += c
      i++
      continue
    }
    const end = template.indexOf('}', i + 1)
    const body = end === -1 ? '' : template.slice(i + 1, end)
    if (end === -1 || body.includes('{')) return { ok: false, error: `Unmatched '{' at position ${i}` }
    if (body === '') return { ok: false, error: `Empty expression '{}' at position ${i}` }

    let op: Operator = ''
    let names = body
    const first = body[0]
    if (SUPPORTED_OPERATORS.has(first)) {
      op = first as Operator
      names = body.slice(1)
    } else if (UNSUPPORTED_OPERATORS.has(first)) {
      return { ok: false, error: `Unsupported operator '${first}' in {${body}}` }
    }

    const vars: string[] = []
    for (const spec of names.split(',')) {
      if (spec.endsWith('*')) return { ok: false, error: `Unsupported modifier '*' in {${body}}` }
      if (spec.includes(':')) return { ok: false, error: `Unsupported modifier ':' in {${body}}` }
      if (!VAR_NAME_RE.test(spec)) {
        return { ok: false, error: spec === '' ? `Missing variable name in {${body}}` : `Invalid variable name '${spec}' in {${body}}` }
      }
      vars.push(spec)
    }

    if (literal) parts.push({ kind: 'literal', text: literal })
    literal = ''
    parts.push({ kind: 'expr', op, vars })
    i = end + 1
  }
  if (literal) parts.push({ kind: 'literal', text: literal })
  return { ok: true, parts }
}

/** Variable names in order of first appearance, without duplicates. `[]` when the template cannot be parsed. */
export function extractTemplateVariables(template: string): string[] {
  const parsed = parseTemplate(template)
  if (!parsed.ok) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parsed.parts) {
    if (part.kind !== 'expr') continue
    for (const v of part.vars) {
      if (!seen.has(v)) {
        seen.add(v)
        out.push(v)
      }
    }
  }
  return out
}

/** Encodes everything except RFC 3986 unreserved characters. */
function encodeUnreserved(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** Keeps reserved and unreserved characters and existing %XX triplets; encodes the rest. */
function encodeReserved(value: string): string {
  return value
    .split(/(%[0-9A-Fa-f]{2})/)
    .map((chunk, i) =>
      i % 2 === 1 ? chunk : chunk.replace(/[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]/gu, (c) => encodeURIComponent(c)),
    )
    .join('')
}

function lookup(values: Record<string, string | undefined>, name: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(values, name)) return undefined
  const v = values[name]
  return v === undefined || v === '' ? undefined : v
}

/**
 * Expands `template` with `values`. Undefined and empty values count as missing: `{var}`, `{+var}` and `{#var}`
 * expand them to nothing and report the name in `missing`; `{?a,b}` / `{&a}` simply leave them out.
 */
export function expandUriTemplate(template: string, values: Record<string, string | undefined>): ExpandResult {
  const parsed = parseTemplate(template)
  if (!parsed.ok) return parsed
  const missing: string[] = []
  const markMissing = (name: string) => {
    if (!missing.includes(name)) missing.push(name)
  }
  try {
    let uri = ''
    for (const part of parsed.parts) {
      if (part.kind === 'literal') {
        uri += part.text
        continue
      }
      if (part.op === '?' || part.op === '&') {
        const pairs: string[] = []
        for (const name of part.vars) {
          const v = lookup(values, name)
          if (v !== undefined) pairs.push(`${name}=${encodeUnreserved(v)}`)
        }
        if (pairs.length > 0) uri += (part.op === '?' ? '?' : '&') + pairs.join('&')
        continue
      }
      const encode = part.op === '' ? encodeUnreserved : encodeReserved
      const encoded: string[] = []
      for (const name of part.vars) {
        const v = lookup(values, name)
        if (v === undefined) markMissing(name)
        else encoded.push(encode(v))
      }
      if (encoded.length > 0) uri += (part.op === '#' ? '#' : '') + encoded.join(',')
    }
    return { ok: true, uri, missing }
  } catch {
    return { ok: false, error: 'A value contains invalid Unicode and cannot be encoded' }
  }
}
