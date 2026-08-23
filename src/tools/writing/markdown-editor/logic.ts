import { encode } from 'gpt-tokenizer'

// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------

/** Exact GPT-4o token count using cl100k_base BPE (via gpt-tokenizer). */
export function countTokensGpt(text: string): number {
  if (!text) return 0
  return encode(text).length
}

/** Approximate token count for Claude / Gemini (SentencePiece-like, ~chars / 3.8). */
export function countTokensApprox(text: string): number {
  if (!text) return 0
  return Math.round(text.length / 3.8)
}

// ---------------------------------------------------------------------------
// Text statistics
// ---------------------------------------------------------------------------

/** Count words — splits on any run of whitespace, ignores empty tokens. */
export function countWords(text: string): number {
  if (!text.trim()) return 0
  return text.trim().split(/\s+/).length
}

/** Count characters (raw length). */
export function countChars(text: string): number {
  return text.length
}

/** Count lines — number of newline-separated segments (minimum 1 for non-empty). */
export function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

// ---------------------------------------------------------------------------
// Document helpers
// ---------------------------------------------------------------------------

/**
 * Generate the next "Untitled N" title.
 * Scans existing titles and returns the first N ≥ 1 not already taken.
 */
export function generateDocTitle(existingTitles: string[]): string {
  const used = new Set(existingTitles)
  let n = 1
  while (used.has(`Untitled ${n}`)) n++
  return `Untitled ${n}`
}

// ---------------------------------------------------------------------------
// Version history helpers
// ---------------------------------------------------------------------------

/** Maximum number of auto-versions to retain per document. */
export const AUTO_VERSION_CAP = 50

/** Minimal shape required by version-pruning utilities (avoids circular dep with store). */
interface HasAutoFlag {
  id: string
  auto: boolean
}

/**
 * Prune excess auto-versions from a newest-first ordered array.
 * Pinned versions (auto=false) are never removed.
 * Auto-versions beyond `cap` (counting from the front, i.e. newest first) are
 * filtered out while preserving the original array ordering.
 */
export function pruneAutoVersions<T extends HasAutoFlag>(
  versions: T[],
  cap = AUTO_VERSION_CAP,
): T[] {
  let autoCount = 0
  return versions.filter((v) => {
    if (!v.auto) return true // pinned — always keep
    autoCount++
    return autoCount <= cap
  })
}

/**
 * Format a version timestamp as a human-readable relative/absolute string.
 * @param savedAt  Unix timestamp in milliseconds.
 * @param now      Current time in ms — injectable for deterministic tests.
 */
export function formatVersionTime(savedAt: number, now = Date.now()): string {
  const diffMs = now - savedAt
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHour = Math.floor(diffMs / 3_600_000)
  const diffDay = Math.floor(diffMs / 86_400_000)
  const date = new Date(savedAt)
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' })

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin} min ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay === 1) return `Yesterday at ${timeStr}`
  if (diffDay < 7) return `${diffDay} days ago`
  return `${dateStr} at ${timeStr}`
}
