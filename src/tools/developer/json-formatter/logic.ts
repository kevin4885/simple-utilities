/**
 * JSON Formatter — pure logic (no React, no side-effects)
 */

export type IndentOption = 2 | 4 | 'tab'

export interface FormatOptions {
  indent: IndentOption
  sortKeys: boolean
}

export interface ValidationResult {
  ok: boolean
  error?: string
  line?: number
  column?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function indentStr(indent: IndentOption): string | number {
  return indent === 'tab' ? '\t' : indent
}

/**
 * Sort all object keys recursively (arrays left in original order).
 */
function sortKeysRecursive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursive)
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortKeysRecursive((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate JSON and return a structured result with optional line/column info.
 *
 * JavaScript's built-in JSON.parse throws a SyntaxError whose `message` often
 * contains position info like "at position 42" or "line 3 column 7".  We parse
 * those numbers out when available.
 */
export function validateJson(input: string): ValidationResult {
  if (input.trim() === '') {
    return { ok: false, error: 'Input is empty' }
  }
  try {
    JSON.parse(input)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)

    // Modern V8/Node: "... line N column M" (without "at position" prefix)
    const lineColMatch = msg.match(/line (\d+) column (\d+)/)
    if (lineColMatch) {
      return {
        ok: false,
        error: msg,
        line: parseInt(lineColMatch[1], 10),
        column: parseInt(lineColMatch[2], 10),
      }
    }

    // Older engines / Firefox: "at position N" — convert to approximate line/col
    const posMatch = msg.match(/at position (\d+)/)
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10)
      const before = input.slice(0, pos)
      const line = before.split('\n').length
      const lastNewline = before.lastIndexOf('\n')
      const column = lastNewline === -1 ? pos + 1 : pos - lastNewline
      return { ok: false, error: msg, line, column }
    }

    return { ok: false, error: msg }
  }
}

/**
 * Format (pretty-print) JSON with the given indent and optional key sorting.
 * Returns `null` if the input is not valid JSON.
 */
export function formatJson(input: string, options: FormatOptions): string | null {
  try {
    let parsed: unknown = JSON.parse(input)
    if (options.sortKeys) {
      parsed = sortKeysRecursive(parsed)
    }
    return JSON.stringify(parsed, null, indentStr(options.indent))
  } catch {
    return null
  }
}

/**
 * Minify JSON by removing all unnecessary whitespace.
 * Returns `null` if the input is not valid JSON.
 */
export function minifyJson(input: string): string | null {
  try {
    return JSON.stringify(JSON.parse(input))
  } catch {
    return null
  }
}
