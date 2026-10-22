// Pure helpers for the Prompts tab (no React, no side effects).

import { toArguments, type FieldError, type FormValue, type JsonSchema } from '../../schema-form'

export interface PromptArgument {
  name: string
  description?: string
  required?: boolean
}

/**
 * JSON Schema describing a prompt's arguments. Prompt arguments are always strings on the wire, so every
 * property is `{type:'string'}`; `required` lists only the arguments flagged required.
 */
export function promptArgsToSchema(args: readonly PromptArgument[] | undefined): JsonSchema {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const arg of args ?? []) {
    properties[arg.name] = {
      type: 'string',
      ...(arg.description !== undefined ? { description: arg.description } : {}),
    }
    if (arg.required === true) required.push(arg.name)
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

/** Reads `prompt.arguments` defensively: server data is untrusted. */
export function parsePromptArguments(value: unknown): PromptArgument[] {
  if (!Array.isArray(value)) return []
  const out: PromptArgument[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    if (typeof rec.name !== 'string' || rec.name === '' || seen.has(rec.name)) continue
    seen.add(rec.name)
    out.push({
      name: rec.name,
      ...(typeof rec.description === 'string' ? { description: rec.description } : {}),
      ...(typeof rec.required === 'boolean' ? { required: rec.required } : {}),
    })
  }
  return out
}

/** Case-insensitive substring filter over name, title and description. An empty query keeps everything. */
export function filterPrompts<T extends { name?: unknown; title?: unknown; description?: unknown }>(
  prompts: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...prompts]
  return prompts.filter((p) =>
    [p.name, p.title, p.description].some((v) => typeof v === 'string' && v.toLowerCase().includes(q)),
  )
}

export interface PromptMessageView {
  role: string
  content: unknown[]
}

/** `messages[]` of a `prompts/get` result as `{role, content[]}` for ContentView (`content` is a single block). */
export function promptMessages(result: unknown): PromptMessageView[] {
  if (typeof result !== 'object' || result === null) return []
  const messages = (result as { messages?: unknown }).messages
  if (!Array.isArray(messages)) return []
  return messages.map((m) => {
    const rec = typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : {}
    return { role: typeof rec.role === 'string' ? rec.role : 'unknown', content: rec.content === undefined ? [] : [rec.content] }
  })
}

/**
 * Turns the SchemaForm value into the prompts/get arguments (all strings). A required argument that is
 * missing or blank is an error; an optional blank argument is left out.
 */
export function buildPromptArguments(
  schema: JsonSchema,
  value: FormValue,
): { ok: true; arguments: Record<string, string> } | { ok: false; errors: FieldError[] } {
  const converted = toArguments(schema, value)
  const errors: FieldError[] = converted.ok ? [] : [...converted.errors]
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : []
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(converted.ok ? converted.arguments : source)) {
    if (typeof v === 'string' && v !== '') out[key] = v
  }
  for (const name of required) {
    if (typeof name !== 'string') continue
    const v = source[name]
    if ((v === undefined || v === '') && !errors.some((e) => e.path === name)) errors.push({ path: name, message: 'Required' })
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, arguments: out }
}