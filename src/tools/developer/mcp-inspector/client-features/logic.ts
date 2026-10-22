import type { ClientCapabilities } from '@modelcontextprotocol/client'

// Pure helpers for the client-feature area (roots / sampling / elicitation / server logs).
// No React, no stores, no side effects. Everything that comes from the server is `unknown` here and is
// only ever turned into text by the components.

export const LOGGING_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'] as const
export type LoggingLevel = (typeof LOGGING_LEVELS)[number]

export interface RootItem {
  uri: string
  name: string | null
}

/** C9 - the persisted client-feature settings. */
export interface ClientSettings {
  roots: { enabled: boolean; items: RootItem[] }
  sampling: { enabled: boolean }
  elicitation: { enabled: boolean }
  loggingLevel: LoggingLevel
}

export const DEFAULT_SETTINGS: ClientSettings = {
  roots: { enabled: false, items: [] },
  sampling: { enabled: false },
  elicitation: { enabled: false },
  loggingLevel: 'info',
}

export const MAX_ROOTS = 50
export const MAX_ROOT_URI_CHARS = 2048
export const MAX_ROOT_NAME_CHARS = 200
export const MAX_RECENT = 20
export const MAX_SERVER_LOGS = 500
export const SUMMARY_MAX_CHARS = 120

// ── Roots ─────────────────────────────────────────────────────────────────────

// `file://...` is the common case and also matches this; any other URI scheme is accepted too.
const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/

/** Returns an error message, or null when `uri` is acceptable. The caller trims first; whitespace inside is rejected. */
export function validateRootUri(uri: unknown): string | null {
  if (typeof uri !== 'string' || uri === '') return 'Enter a root URI, e.g. file:///home/me/project'
  if (uri.length > MAX_ROOT_URI_CHARS) return `URI is too long (max ${MAX_ROOT_URI_CHARS} characters)`
  if (/\s/.test(uri)) return 'URI must not contain spaces'
  if (!URI_SCHEME_RE.test(uri)) return 'URI must start with file:// or another URI scheme such as https:'
  return null
}

/** Trims; empty -> null. Returns an error message instead when the name is too long. */
export function normalizeRootName(name: string): { ok: true; name: string | null } | { ok: false; error: string } {
  const t = name.trim()
  if (t.length > MAX_ROOT_NAME_CHARS) return { ok: false, error: `Name is too long (max ${MAX_ROOT_NAME_CHARS} characters)` }
  return { ok: true, name: t === '' ? null : t }
}

/** The `roots/list` result. `name` is omitted (not null) when unset. */
export function rootsResult(items: readonly RootItem[]): { roots: { uri: string; name?: string }[] } {
  return { roots: items.map((r) => (r.name === null ? { uri: r.uri } : { uri: r.uri, name: r.name })) }
}

// ── Capabilities ──────────────────────────────────────────────────────────────

/** What the client declares at connect time. Elicitation declares both modes (form and URL). */
export function capabilitiesFromSettings(s: ClientSettings): ClientCapabilities {
  const caps: ClientCapabilities = {}
  if (s.roots.enabled) caps.roots = {}
  if (s.sampling.enabled) caps.sampling = {}
  if (s.elicitation.enabled) caps.elicitation = { form: {}, url: {} }
  return caps
}

/** What was in effect when the current connection was configured (used for "Reconnect to apply"). */
export interface AppliedSnapshot {
  roots: boolean
  sampling: boolean
  elicitation: boolean
  rootsKey: string
  /** True only if the client declared `roots.listChanged` (then list changes can be announced to the server). */
  rootsListChanged: boolean
}

/** Stable signature of a roots list, to detect edits. */
export function rootsSignature(items: readonly RootItem[]): string {
  return JSON.stringify(items.map((r) => [r.uri, r.name]))
}

export function snapshotSettings(s: ClientSettings, caps: ClientCapabilities): AppliedSnapshot {
  return {
    roots: s.roots.enabled,
    sampling: s.sampling.enabled,
    elicitation: s.elicitation.enabled,
    rootsKey: rootsSignature(s.roots.items),
    rootsListChanged: caps.roots?.listChanged === true,
  }
}

/** True when the settings now differ from what the live connection was configured with. */
export function needsReconnect(applied: AppliedSnapshot | null, s: ClientSettings): boolean {
  if (applied === null) return false
  // Editing the list of a feature that is off (and was off at connect time) changes nothing the server sees.
  const rootsEdited = (applied.roots || s.roots.enabled) && applied.rootsKey !== rootsSignature(s.roots.items)
  return (
    applied.roots !== s.roots.enabled ||
    applied.sampling !== s.sampling.enabled ||
    applied.elicitation !== s.elicitation.enabled ||
    rootsEdited
  )
}

// ── Server-originated requests (all untrusted) ────────────────────────────────

export type PendingKind = 'sampling' | 'elicitation'

type Rec = Record<string, unknown>

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export interface SamplingView {
  systemPrompt: string | null
  messages: { role: string; blocks: unknown[] }[]
  maxTokens: number | null
  modelPreferences: unknown
  /** Every other parameter (temperature, stopSequences, includeContext, tools, ...), shown read-only. */
  other: Rec
}

const SAMPLING_SHOWN_KEYS = new Set(['messages', 'systemPrompt', 'maxTokens', 'modelPreferences', '_meta'])

export function parseSamplingParams(params: unknown): SamplingView {
  const p = isRec(params) ? params : {}
  const messages = Array.isArray(p.messages) ? p.messages : []
  const other: Rec = {}
  for (const [k, v] of Object.entries(p)) if (!SAMPLING_SHOWN_KEYS.has(k)) other[k] = v
  return {
    systemPrompt: str(p.systemPrompt),
    messages: messages.map((m) => {
      const msg = isRec(m) ? m : {}
      const content = msg.content
      return {
        role: str(msg.role) ?? 'unknown',
        blocks: Array.isArray(content) ? content : content === undefined ? [] : [content],
      }
    }),
    maxTokens: typeof p.maxTokens === 'number' ? p.maxTokens : null,
    modelPreferences: p.modelPreferences,
    other,
  }
}

export type ElicitationView =
  | { mode: 'form'; message: string; schema: Rec | null }
  | { mode: 'url'; message: string; url: string; elicitationId: string | null }

export function parseElicitationParams(params: unknown): ElicitationView {
  const p = isRec(params) ? params : {}
  const message = str(p.message) ?? ''
  if (p.mode === 'url') return { mode: 'url', message, url: str(p.url) ?? '', elicitationId: str(p.elicitationId) }
  return { mode: 'form', message, schema: isRec(p.requestedSchema) ? p.requestedSchema : null }
}

export interface UrlAnalysis {
  /** `URL.host` (punycode for IDNs, with port), or null if it cannot be determined. */
  host: string | null
  /** The normalised URL (URL.href) that is opened - the same parse the host above comes from. Null if unparsable. */
  href: string | null
  /** True only for http: / https: URLs. */
  openable: boolean
  /** Why the link cannot be opened (shown instead of enabling Open), else null. */
  refusal: string | null
  warnings: string[]
}

export function analyzeUrl(url: string): UrlAnalysis {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { host: null, href: null, openable: false, refusal: 'Refused: this is not a valid URL.', warnings: [] }
  }
  const host = u.host === '' ? null : u.host
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return {
      host,
      href: null,
      openable: false,
      refusal: `Refused: only http and https links can be opened (this link uses "${u.protocol}").`,
      warnings: [],
    }
  }
  const warnings: string[] = []
  if (u.username !== '' || u.password !== '') {
    warnings.push('This URL contains embedded credentials (text before the @). Check the host above carefully.')
  }
  return { host, href: u.href, openable: true, refusal: null, warnings }
}

/** One line describing a request, for the pending / recent lists. */
export function summarizeRequest(kind: PendingKind, params: unknown): string {
  if (kind === 'elicitation') {
    const v = parseElicitationParams(params)
    return truncate(v.message || (v.mode === 'url' ? 'URL request' : 'Information request'), SUMMARY_MAX_CHARS)
  }
  const v = parseSamplingParams(params)
  const first = v.messages[0]?.blocks[0]
  const text = isRec(first) ? str(first.text) : null
  return truncate(text ?? v.systemPrompt ?? 'Sampling request', SUMMARY_MAX_CHARS)
}

// ── Answers ───────────────────────────────────────────────────────────────────

export const SAMPLING_REJECT_CODE = -1
export const SAMPLING_REJECT_MESSAGE = 'User rejected sampling request'
export const DEFAULT_SAMPLING_MODEL = 'manual'
export const DEFAULT_STOP_REASON = 'endTurn'

export function buildSamplingResult(input: { text: string; model: string; stopReason: string }) {
  return {
    role: 'assistant' as const,
    content: { type: 'text' as const, text: input.text },
    model: input.model.trim() || DEFAULT_SAMPLING_MODEL,
    stopReason: input.stopReason.trim() || DEFAULT_STOP_REASON,
  }
}

export type ElicitAction = 'accept' | 'decline' | 'cancel'

export function buildElicitResult(action: ElicitAction, content?: Record<string, unknown>) {
  return action === 'accept' && content !== undefined ? { action, content } : { action }
}

/** A form elicitation answer may only hold string, number, boolean or string[] values (MCP spec / SDK result schema). */
export function validateElicitContent(content: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(content)) {
    const ok =
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      (Array.isArray(v) && v.every((x) => typeof x === 'string'))
    if (!ok) return `Field "${k}" must be a string, number, boolean or list of strings.`
  }
  return null
}

/** Parses the raw-JSON fallback of a form elicitation; the answer must be a JSON object. */
export function parseRawContent(text: string): { ok: true; content: Record<string, unknown> } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!isRec(parsed)) return { ok: false, error: 'The response must be a JSON object.' }
  return { ok: true, content: parsed }
}

// ── Server log notifications ──────────────────────────────────────────────────

export interface ServerLogParams {
  level: string
  logger: string | null
  data: unknown
}

export function parseLogParams(params: unknown): ServerLogParams {
  const p = isRec(params) ? params : {}
  return { level: str(p.level) ?? 'unknown', logger: str(p.logger), data: p.data }
}

export type LogTone = 'quiet' | 'normal' | 'warn' | 'error'

export function logTone(level: string): LogTone {
  switch (level) {
    case 'debug':
    case 'info':
      return 'quiet'
    case 'notice':
      return 'normal'
    case 'warning':
      return 'warn'
    case 'error':
    case 'critical':
    case 'alert':
    case 'emergency':
      return 'error'
    default:
      return 'normal'
  }
}
