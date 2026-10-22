// Pure helpers for the Tools tab: tool list normalisation/filtering, argument conversion between the
// schema form and raw JSON, call-result classification, output-schema checking and history selection.
// No React, no side effects.

import { ProtocolError, SdkError, SdkErrorCode, type Progress, type StandardSchemaV1 } from '@modelcontextprotocol/client'
import { errorMessage } from '../../connection/logic'
import type { HistoryEntry } from '../../schemas'
import {
  describeField,
  indexPath,
  initialFormValue,
  joinPath,
  supportsForm,
  toArguments,
  validateAgainstSchema,
  type FieldDesc,
  type FieldError,
  type FormValue,
  type JsonSchema,
} from '../../schema-form/logic'

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
const nonEmptyString = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

/** Assign as an OWN property even for keys like `__proto__` (user/server supplied objects are untrusted). */
function setOwn(target: Rec, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/** Accepts any result so a non-compliant reply is shown as the server sent it, not rejected by SDK validation. */
export const ANY_RESULT: StandardSchemaV1<unknown, unknown> = {
  '~standard': { version: 1, vendor: 'simple-utilities-mcp-inspector', validate: (value) => ({ value }) },
}

// ── tools ────────────────────────────────────────────────────────────────────

export const ANNOTATION_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const
export type AnnotationKey = (typeof ANNOTATION_KEYS)[number]
export type ToolAnnotationsView = Partial<Record<AnnotationKey, boolean>>

export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  annotations: ToolAnnotationsView
}

/** Null when the entry is unusable (no string name). Malformed optional fields are dropped, never thrown on. */
export function normalizeTool(raw: unknown): McpTool | null {
  if (!isRec(raw) || typeof raw.name !== 'string' || raw.name === '') return null
  const annotations: ToolAnnotationsView = {}
  if (isRec(raw.annotations)) {
    for (const k of ANNOTATION_KEYS) {
      const v = raw.annotations[k]
      if (typeof v === 'boolean') annotations[k] = v
    }
  }
  return {
    name: raw.name,
    title: nonEmptyString(raw.title),
    description: nonEmptyString(raw.description),
    inputSchema: isRec(raw.inputSchema) ? raw.inputSchema : {},
    outputSchema: isRec(raw.outputSchema) ? raw.outputSchema : undefined,
    annotations,
  }
}

/** One `tools/list` result page. Throws on a result not shaped like one (collectPages reports it as the error). */
export function parseToolsPage(result: unknown): { items: McpTool[]; nextCursor?: string } {
  if (!isRec(result) || !Array.isArray(result.tools)) {
    throw new Error('Malformed tools/list result: expected a "tools" array')
  }
  const items = result.tools.map(normalizeTool).filter((t): t is McpTool => t !== null)
  const next = result.nextCursor
  return { items, ...(typeof next === 'string' && next !== '' ? { nextCursor: next } : {}) }
}

export function toolLabel(tool: McpTool): string {
  return tool.title ?? tool.name
}

/** Case-insensitive match on name, title and description. A blank query keeps everything. */
export function filterTools(tools: McpTool[], query: string): McpTool[] {
  const q = query.trim().toLowerCase()
  if (q === '') return tools
  return tools.filter((t) => [t.name, t.title, t.description].some((s) => s !== undefined && s.toLowerCase().includes(q)))
}

export function countLabel(shown: number, total: number): string {
  const noun = (n: number) => `${n} ${n === 1 ? 'tool' : 'tools'}`
  return shown === total ? noun(total) : `${shown} of ${noun(total)}`
}

const BADGE_TEXT: Record<AnnotationKey, string> = {
  readOnlyHint: 'read-only',
  destructiveHint: 'destructive',
  idempotentHint: 'idempotent',
  openWorldHint: 'open-world',
}

export interface AnnotationBadge {
  key: AnnotationKey
  label: string
  value: boolean
}

/** One badge per hint the server actually sent; a hint sent as `false` reads "not <hint>". */
export function annotationBadges(tool: McpTool): AnnotationBadge[] {
  const out: AnnotationBadge[] = []
  for (const key of ANNOTATION_KEYS) {
    const value = tool.annotations[key]
    if (value === undefined) continue
    out.push({ key, value, label: value ? BADGE_TEXT[key] : `not ${BADGE_TEXT[key]}` })
  }
  return out
}

/** Only an explicit `destructiveHint: true` asks for confirmation; an absent or false hint never does. */
export function isDestructive(tool: McpTool): boolean {
  return tool.annotations.destructiveHint === true
}

export function truncationNotice(reason: 'max-pages' | 'cursor-loop' | null): string {
  return reason === 'cursor-loop'
    ? 'The list is incomplete: the server returned a pagination cursor it had already returned.'
    : 'The list is incomplete: the page limit was reached before the server stopped paginating.'
}

// ── arguments ────────────────────────────────────────────────────────────────

export const DEFAULT_TIMEOUT_MS = 60000
export const MIN_TIMEOUT_MS = 1000
export const MAX_TIMEOUT_MS = 3_600_000

/** Blank or non-numeric -> default; otherwise rounded and clamped to [1000, 3 600 000]. */
export function clampTimeoutMs(input: string | number): number {
  if (typeof input === 'string' && input.trim() === '') return DEFAULT_TIMEOUT_MS
  const n = typeof input === 'number' ? input : Number(input.trim())
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(n)))
}

export type ArgsParse = { ok: true; value: Rec } | { ok: false; error: string }

/** The JSON editor's text as an arguments object. Blank text means `{}`; arrays and primitives are rejected. */
export function parseArgsText(text: string): ArgsParse {
  if (text.trim() === '') return { ok: true, value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (!isRec(parsed)) return { ok: false, error: 'Arguments must be a JSON object' }
  return { ok: true, value: parsed }
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '{}'
}

function valueToForm(desc: FieldDesc, v: unknown, path: string, dropped: string[]): unknown {
  if (v === null && desc.nullable) return null
  switch (desc.kind) {
    case 'raw':
      // Fields the form cannot model are edited as JSON text.
      return JSON.stringify(v, null, 2) ?? ''
    case 'array': {
      if (!Array.isArray(v)) return v
      const item = describeField(desc.schema.items)
      return v.map((x, i) => valueToForm(item, x, indexPath(path, i), dropped))
    }
    case 'object':
      return isRec(v) ? objectToForm(desc.schema, v, path, dropped) : v
    default:
      return v
  }
}

function objectToForm(schema: JsonSchema, rec: Rec, path: string, dropped: string[]): Rec {
  const props = isRec(schema.properties) ? schema.properties : {}
  const out: Rec = {}
  for (const [key, v] of Object.entries(rec)) {
    const p = joinPath(path, key)
    if (!hasOwn(props, key)) {
      dropped.push(p)
      continue
    }
    setOwn(out, key, valueToForm(describeField(props[key]), v, p, dropped))
  }
  return out
}

/**
 * Loads an arguments object into the editing state `SchemaForm` expects. Keys the form has no field for
 * cannot be represented; they are reported in `dropped` (dotted paths) rather than kept silently.
 * A required field absent from `args` stays unset, so the next `toArguments` reports it as Required.
 */
export function argumentsToFormValue(schema: JsonSchema, args: Rec): { value: FormValue; dropped: string[] } {
  const dropped: string[] = []
  return { value: objectToForm(isRec(schema) ? schema : {}, args, '', dropped), dropped }
}

/** Form -> JSON: pretty `toArguments` output, or `{}` plus the field errors when the form is not valid yet. */
export function formToJsonText(schema: JsonSchema, value: FormValue): { text: string; errors: FieldError[] } {
  const r = toArguments(schema, value)
  return r.ok ? { text: prettyJson(r.arguments), errors: [] } : { text: '{}', errors: r.errors }
}

/** JSON -> Form: parses the editor text and loads it as form values. */
export function jsonTextToForm(
  schema: JsonSchema,
  text: string,
): { ok: true; value: FormValue; dropped: string[] } | { ok: false; error: string } {
  const parsed = parseArgsText(text)
  if (!parsed.ok) return parsed
  return { ok: true, ...argumentsToFormValue(schema, parsed.value) }
}

// ── editing draft ────────────────────────────────────────────────────────────

export interface ToolDraft {
  mode: 'form' | 'json'
  formValue: FormValue
  jsonText: string
}

/** Form when the schema is supported, else the JSON editor. */
export function initialDraft(tool: McpTool): ToolDraft {
  const ok = supportsForm(tool.inputSchema).ok
  return { mode: ok ? 'form' : 'json', formValue: ok ? initialFormValue(tool.inputSchema) : {}, jsonText: '{}' }
}

/** Why the Form option is unavailable (shown as its title), or null when switching to it would work. */
export function formBlockedReason(schema: JsonSchema, draft: ToolDraft): string | null {
  const support = supportsForm(schema)
  if (!support.ok) return support.reason
  if (draft.mode === 'json') {
    const parsed = parseArgsText(draft.jsonText)
    if (!parsed.ok) return `Invalid JSON: ${parsed.error}`
  }
  return null
}

export interface ModeSwitch {
  draft: ToolDraft
  errors: FieldError[]
  notice: string | null
}

/** Moves the arguments between the form and the JSON editor so the two never disagree. */
export function switchMode(schema: JsonSchema, draft: ToolDraft, to: ToolDraft['mode']): ModeSwitch {
  if (to === draft.mode) return { draft, errors: [], notice: null }
  if (to === 'json') {
    const r = formToJsonText(schema, draft.formValue)
    return { draft: { ...draft, mode: 'json', jsonText: r.text }, errors: r.errors, notice: null }
  }
  const blocked = formBlockedReason(schema, draft)
  if (blocked !== null) return { draft, errors: [], notice: blocked }
  const loaded = jsonTextToForm(schema, draft.jsonText)
  if (!loaded.ok) return { draft, errors: [], notice: `Invalid JSON: ${loaded.error}` }
  const notice = loaded.dropped.length > 0 ? `Not representable in the form and dropped: ${loaded.dropped.join(', ')}` : null
  return { draft: { ...draft, mode: 'form', formValue: loaded.value }, errors: [], notice }
}

/** History "Load": puts a saved arguments JSON text into the draft, staying in the current mode when it can. */
export function loadHistoryArgs(schema: JsonSchema, draft: ToolDraft, argsJson: string): ModeSwitch {
  const parsed = parseArgsText(argsJson)
  if (!parsed.ok) {
    // e.g. a truncated entry: keep the text so it can be repaired by hand
    return {
      draft: { ...draft, mode: 'json', jsonText: argsJson },
      errors: [],
      notice: `The saved arguments are not valid JSON (${parsed.error}); loaded as text.`,
    }
  }
  if (draft.mode === 'form' && supportsForm(schema).ok) {
    const loaded = argumentsToFormValue(schema, parsed.value)
    const notice = loaded.dropped.length > 0 ? `Not representable in the form and dropped: ${loaded.dropped.join(', ')}` : null
    return { draft: { ...draft, formValue: loaded.value }, errors: [], notice }
  }
  return { draft: { ...draft, mode: 'json', jsonText: prettyJson(parsed.value) }, errors: [], notice: null }
}
// ── call outcome ─────────────────────────────────────────────────────────────

export type RpcErrorView = { code: number; message: string; data?: unknown }

export type CallOutcome =
  | { kind: 'success'; result: Rec }
  | { kind: 'tool-error'; result: Rec }
  | { kind: 'protocol-error'; error: RpcErrorView }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string }

/** `isError: true` is the tool failing; anything else the server sent back counts as a normal result. */
export function classifyCallResult(raw: unknown): CallOutcome {
  if (!isRec(raw)) return { kind: 'failed', message: 'The server returned a result that is not a JSON object.' }
  return raw.isError === true ? { kind: 'tool-error', result: raw } : { kind: 'success', result: raw }
}

/** Separates the ways a request can fail: user abort, JSON-RPC error, local timeout, anything else. */
export function classifyCallError(e: unknown, o: { timeoutMs: number; aborted: boolean }): CallOutcome {
  if (o.aborted) return { kind: 'cancelled' }
  if (e instanceof ProtocolError) {
    return {
      kind: 'protocol-error',
      error: { code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) },
    }
  }
  if (e instanceof SdkError && e.code === SdkErrorCode.RequestTimeout) return { kind: 'timeout', timeoutMs: o.timeoutMs }
  return { kind: 'failed', message: errorMessage(e) }
}

export type OutputCheck =
  | { status: 'none' } // the tool declares no outputSchema
  | { status: 'skipped' } // only a normal result is expected to carry structured output
  | { status: 'valid' }
  | { status: 'invalid'; issues: string[] }

const pathLabel = (path: string): string => (path === '' ? '(root)' : path)

/** Non-blocking comparison of `structuredContent` with the tool's `outputSchema`. */
export function checkOutputSchema(tool: McpTool, outcome: CallOutcome): OutputCheck {
  if (!tool.outputSchema) return { status: 'none' }
  if (outcome.kind !== 'success') return { status: 'skipped' }
  const sc = outcome.result.structuredContent
  if (sc === undefined) {
    return { status: 'invalid', issues: ['(root): the result has no structuredContent, but the tool declares an outputSchema'] }
  }
  const errors = validateAgainstSchema(tool.outputSchema, sc)
  return errors.length === 0
    ? { status: 'valid' }
    : { status: 'invalid', issues: errors.map((e) => `${pathLabel(e.path)}: ${e.message}`) }
}

export interface ProgressView {
  /** 0..1, or null when the server gave no (usable) total: the bar is then indeterminate. */
  fraction: number | null
  label: string
  message: string | null
}

export function progressView(p: Progress): ProgressView {
  const total = typeof p.total === 'number' && p.total > 0 ? p.total : null
  return {
    fraction: total === null ? null : Math.min(1, Math.max(0, p.progress / total)),
    label: total === null ? String(p.progress) : `${p.progress} / ${total}`,
    message: typeof p.message === 'string' && p.message !== '' ? p.message : null,
  }
}

// ── history ──────────────────────────────────────────────────────────────────

/** Tool-call history for one profile and one tool, newest first (the store appends in time order). */
export function toolHistory(history: HistoryEntry[], profileId: string, toolName: string): HistoryEntry[] {
  return history.filter((h) => h.kind === 'tool' && h.profileId === profileId && h.name === toolName).reverse()
}

export function argsPreview(argsJson: string, max = 120): string {
  const flat = argsJson.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
