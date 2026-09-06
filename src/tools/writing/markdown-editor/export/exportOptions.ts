/**
 * exportOptions
 *
 * Schema, defaults and labels for the Markdown Editor's export styling
 * options (`exportPrefs` in store.ts). Pure, React-free — safe to import from
 * builders, the store, and UI components alike.
 */

import { z } from 'zod'

// ── Enums ──────────────────────────────────────────────────────────────────

export const EXPORT_PRESETS = ['document', 'github', 'compact'] as const
export const EXPORT_PAPERS  = ['letter', 'a4'] as const
export const EXPORT_MARGINS = ['normal', 'narrow'] as const

export type ExportPreset = typeof EXPORT_PRESETS[number]
export type ExportPaper  = typeof EXPORT_PAPERS[number]
export type ExportMargin = typeof EXPORT_MARGINS[number]

// ── Schema ─────────────────────────────────────────────────────────────────

export const ExportOptionsSchema = z.object({
  preset:       z.enum(EXPORT_PRESETS),
  paper:        z.enum(EXPORT_PAPERS),
  margins:      z.enum(EXPORT_MARGINS),
  titleBlock:   z.boolean(),
  showLinkUrls: z.boolean(),
  pageBreakH1:  z.boolean(),
})

export type ExportOptions = z.infer<typeof ExportOptionsSchema>

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  preset: 'document',
  paper: 'letter',
  margins: 'normal',
  titleBlock: false,
  showLinkUrls: true,
  pageBreakH1: false,
}

// ── Labels (for the export dialog's ToggleGroups) ─────────────────────────

export const PRESET_LABELS: Record<ExportPreset, string> = {
  document: 'Document',
  github: 'GitHub',
  compact: 'Compact',
}

export const PAPER_LABELS: Record<ExportPaper, string> = {
  letter: 'Letter',
  a4: 'A4',
}

export const MARGIN_LABELS: Record<ExportMargin, string> = {
  normal: 'Normal',
  narrow: 'Narrow',
}

// ── Resolution ─────────────────────────────────────────────────────────────

/** Per-field schemas — used by `resolveExportOptions` to validate one field at a time. */
const FIELD_SCHEMAS = {
  preset: z.enum(EXPORT_PRESETS),
  paper: z.enum(EXPORT_PAPERS),
  margins: z.enum(EXPORT_MARGINS),
  titleBlock: z.boolean(),
  showLinkUrls: z.boolean(),
  pageBreakH1: z.boolean(),
} satisfies { [K in keyof ExportOptions]: z.ZodType<ExportOptions[K]> }

/**
 * Merge a (possibly partial, possibly garbage) persisted/partial value over
 * `DEFAULT_EXPORT_OPTIONS`. Tolerant per-field: an invalid value for one
 * field falls back to its default while valid sibling fields are kept —
 * never throws on garbage input (e.g. corrupted localStorage).
 */
export function resolveExportOptions(partial: unknown): ExportOptions {
  if (partial === null || typeof partial !== 'object') return { ...DEFAULT_EXPORT_OPTIONS }

  const merged: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS }
  const source = partial as Record<string, unknown>
  for (const key of Object.keys(FIELD_SCHEMAS) as (keyof ExportOptions)[]) {
    const value = source[key]
    if (value === undefined) continue
    const result = FIELD_SCHEMAS[key].safeParse(value)
    if (result.success) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[key] = result.data
    }
  }
  return merged
}

