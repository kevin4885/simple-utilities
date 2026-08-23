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
