/**
 * Version History — pure logic functions
 *
 * React-free, store-runtime-free helpers used by the history/ UI module.
 * Only a type-only import from `../store` is used (no runtime coupling).
 */

import { formatVersionTime } from '../logic'
import { computeDiff, type DiffResult, type DiffStats } from '@/tools/developer/diff-viewer/logic'
import type { VmeVersion } from '../store'

// ---------------------------------------------------------------------------
// Version kind
// ---------------------------------------------------------------------------

/** Classification of a version for display purposes. */
export type VersionKind = 'pinned' | 'manual' | 'auto'

/** Human-readable label for each VersionKind, used on badges. */
export const VERSION_KIND_LABEL: Record<VersionKind, string> = {
  pinned: 'Pinned',
  manual: 'Manual',
  auto: 'Auto',
}

/**
 * Classify a version: labelled versions are always "pinned" (regardless of
 * the `auto` flag — legacy data may have both set), otherwise "auto" or
 * "manual" per the `auto` flag.
 */
export function getVersionKind(v: VmeVersion): VersionKind {
  if (v.label) return 'pinned'
  return v.auto ? 'auto' : 'manual'
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/** Aggregate counts of versions by kind, plus the total. */
export interface VersionSummary {
  pinned: number
  manual: number
  auto: number
  total: number
}

/** Summarize an array of versions into counts per kind. */
export function summarizeVersions(versions: VmeVersion[]): VersionSummary {
  const summary: VersionSummary = { pinned: 0, manual: 0, auto: 0, total: versions.length }
  for (const v of versions) {
    summary[getVersionKind(v)]++
  }
  return summary
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

/**
 * Display title for a version: its label if present, otherwise a
 * relative/absolute time string derived from `savedAt`.
 * @param now  Current time in ms — injectable for deterministic tests.
 */
export function versionTitle(v: VmeVersion, now = Date.now()): string {
  return v.label ?? formatVersionTime(v.savedAt, now)
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Compute the diff between a version's saved content and the current
 * document content. Inserts = text added since that version; deletes =
 * text removed since that version.
 */
export function computeVersionDiff(versionContent: string, currentContent: string): DiffResult {
  return computeDiff(versionContent, currentContent, { ignoreWhitespace: false, ignoreCase: false })
}

/** True when the diff succeeded and has no additions or deletions. */
export function isIdentical(result: DiffResult): boolean {
  return result.ok && result.stats.additions === 0 && result.stats.deletions === 0
}

/** Format diff stats as "+N −M" (using U+2212 MINUS SIGN, matching the Diff Viewer). */
export function formatDiffStats(stats: DiffStats): string {
  return `+${stats.additions} \u2212${stats.deletions}`
}
