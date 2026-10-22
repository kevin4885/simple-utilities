// Pure helpers for the Raw JSON-RPC tab: params parsing, method policy, timeout parsing.
// No React, no side effects.

export type ParseParamsResult =
  | { ok: true; params: Record<string, unknown> | unknown[] | undefined }
  | { ok: false; error: string }

/** Suggested methods for the method input (typing any other method is always allowed). */
export const KNOWN_METHODS: readonly string[] = [
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'resources/subscribe',
  'resources/unsubscribe',
  'prompts/list',
  'prompts/get',
  'completion/complete',
  'logging/setLevel',
]

export const DEFAULT_TIMEOUT_MS = 60000
export const MIN_TIMEOUT_MS = 1000

/** Position (1-based line/column) for a 0-based character offset. */
function positionOf(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  const column = offset - (before.lastIndexOf('\n') + 1) + 1
  return { line, column }
}

/** Error text for malformed JSON, carrying a line/column whenever the engine reports a position. */
function syntaxErrorMessage(text: string, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const lineCol = msg.match(/line (\d+) column (\d+)/)
  if (lineCol) return `Invalid JSON: ${msg} (line ${lineCol[1]}, column ${lineCol[2]})`
  const pos = msg.match(/position (\d+)/)
  if (pos) {
    const { line, column } = positionOf(text, Number(pos[1]))
    return `Invalid JSON: ${msg} (line ${line}, column ${column})`
  }
  // Engines that report neither (e.g. "Unexpected end of JSON input"): point at the end of the text.
  const end = positionOf(text, text.length)
  return `Invalid JSON: ${msg} (line ${end.line}, column ${end.column})`
}

/**
 * Parses the params editor text. Empty/whitespace means "no params". Per JSON-RPC, params must be
 * a structured value: an object or an array.
 */
export function parseRawParams(text: string): ParseParamsResult {
  if (text.trim() === '') return { ok: true, params: undefined }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: syntaxErrorMessage(text, e) }
  }
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: 'Params must be a JSON object or array' }
  }
  return { ok: true, params: value as Record<string, unknown> | unknown[] }
}

/** Reason the method may not be sent from this tab, or null when it is allowed. */
export function isBlockedMethod(method: string): string | null {
  const m = method.trim()
  if (m === '') return 'Enter a method name'
  if (m === 'initialize') return 'The initialize request is managed by the connection. Use Reconnect to re-initialize'
  if (m === 'notifications/initialized') {
    return 'The initialized notification is sent by the connection. Use Reconnect to re-initialize'
  }
  return null
}

export type TimeoutResult = { ok: true; ms: number } | { ok: false; error: string }

/** Parses the timeout input (whole milliseconds, at least MIN_TIMEOUT_MS). */
export function parseTimeoutMs(text: string): TimeoutResult {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return { ok: false, error: 'Timeout must be a whole number of milliseconds' }
  const ms = Number(t)
  if (!Number.isSafeInteger(ms) || ms < MIN_TIMEOUT_MS) {
    return { ok: false, error: `Timeout must be at least ${MIN_TIMEOUT_MS} ms` }
  }
  return { ok: true, ms }
}

/** `argsJson` recorded in history for a send. */
export function historyArgs(paramsText: string): string {
  return paramsText.trim() === '' ? '{}' : paramsText
}
