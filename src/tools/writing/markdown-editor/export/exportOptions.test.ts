/**
 * exportOptions.test.ts — defaults, resolveExportOptions tolerance, label
 * completeness.
 */

import { describe, it, expect } from 'vitest'
import {
  EXPORT_PRESETS,
  EXPORT_PAPERS,
  EXPORT_MARGINS,
  DEFAULT_EXPORT_OPTIONS,
  resolveExportOptions,
  PRESET_LABELS,
  PAPER_LABELS,
  MARGIN_LABELS,
} from './exportOptions'

describe('DEFAULT_EXPORT_OPTIONS', () => {
  it('matches the shared contract defaults', () => {
    expect(DEFAULT_EXPORT_OPTIONS).toEqual({
      preset: 'document',
      paper: 'letter',
      margins: 'normal',
      titleBlock: false,
      showLinkUrls: true,
      pageBreakH1: false,
    })
  })
})

describe('resolveExportOptions', () => {
  it('undefined → defaults', () => {
    expect(resolveExportOptions(undefined)).toEqual(DEFAULT_EXPORT_OPTIONS)
  })

  it('null → defaults', () => {
    expect(resolveExportOptions(null)).toEqual(DEFAULT_EXPORT_OPTIONS)
  })

  it('garbage (string) → defaults', () => {
    expect(resolveExportOptions('nonsense')).toEqual(DEFAULT_EXPORT_OPTIONS)
  })

  it('garbage (number) → defaults', () => {
    expect(resolveExportOptions(42)).toEqual(DEFAULT_EXPORT_OPTIONS)
  })

  it('empty object → defaults', () => {
    expect(resolveExportOptions({})).toEqual(DEFAULT_EXPORT_OPTIONS)
  })

  it('partial valid input merges over defaults', () => {
    expect(resolveExportOptions({ paper: 'a4', titleBlock: true })).toEqual({
      ...DEFAULT_EXPORT_OPTIONS,
      paper: 'a4',
      titleBlock: true,
    })
  })

  it('per-field invalid: bogus preset falls back but valid sibling field (paper) is kept', () => {
    const result = resolveExportOptions({ preset: 'bogus', paper: 'a4' })
    expect(result.preset).toBe(DEFAULT_EXPORT_OPTIONS.preset)
    expect(result.paper).toBe('a4')
  })

  it('per-field invalid: wrong type for a boolean field falls back to default', () => {
    const result = resolveExportOptions({ titleBlock: 'yes', showLinkUrls: false })
    expect(result.titleBlock).toBe(DEFAULT_EXPORT_OPTIONS.titleBlock)
    expect(result.showLinkUrls).toBe(false)
  })

  it('unknown extra keys are ignored, valid keys still applied', () => {
    const result = resolveExportOptions({ paper: 'a4', unknownField: 'x' })
    expect(result.paper).toBe('a4')
    expect(result).not.toHaveProperty('unknownField')
  })

  it('all-valid full object is preserved exactly', () => {
    const full = { preset: 'compact', paper: 'a4', margins: 'narrow', titleBlock: true, showLinkUrls: false, pageBreakH1: true } as const
    expect(resolveExportOptions(full)).toEqual(full)
  })

  it('never throws on deeply malformed input', () => {
    expect(() => resolveExportOptions({ preset: { nested: true }, paper: [1, 2] })).not.toThrow()
    expect(() => resolveExportOptions([1, 2, 3])).not.toThrow()
  })
})

describe('labels cover every enum member', () => {
  it('PRESET_LABELS has an entry for every EXPORT_PRESETS member', () => {
    for (const p of EXPORT_PRESETS) expect(PRESET_LABELS[p]).toBeTruthy()
  })

  it('PAPER_LABELS has an entry for every EXPORT_PAPERS member', () => {
    for (const p of EXPORT_PAPERS) expect(PAPER_LABELS[p]).toBeTruthy()
  })

  it('MARGIN_LABELS has an entry for every EXPORT_MARGINS member', () => {
    for (const m of EXPORT_MARGINS) expect(MARGIN_LABELS[m]).toBeTruthy()
  })
})
