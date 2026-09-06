/**
 * exportStyles.test.ts — CSS builder: paper/margin/pageBreakH1 toggles,
 * distinct preset blocks, print rules present.
 */

import { describe, it, expect } from 'vitest'
import { buildExportCss } from './exportStyles'
import { DEFAULT_EXPORT_OPTIONS } from './exportOptions'

describe('buildExportCss — @page', () => {
  it('paper: letter → size: Letter', () => {
    const css = buildExportCss({ ...DEFAULT_EXPORT_OPTIONS, paper: 'letter' })
    expect(css).toContain('@page { size: Letter; margin: 20mm; }')
  })

  it('paper: a4 → size: A4', () => {
    const css = buildExportCss({ ...DEFAULT_EXPORT_OPTIONS, paper: 'a4' })
    expect(css).toMatch(/@page\s*\{\s*size:\s*A4;/)
  })

  it('margins: normal → margin: 20mm', () => {
    const css = buildExportCss({ ...DEFAULT_EXPORT_OPTIONS, margins: 'normal' })
    expect(css).toMatch(/margin:\s*20mm/)
  })

  it('margins: narrow → margin: 10mm', () => {
    const css = buildExportCss({ ...DEFAULT_EXPORT_OPTIONS, margins: 'narrow' })
    expect(css).toMatch(/margin:\s*10mm/)
  })
})

describe('buildExportCss — pageBreakH1', () => {
  it('true → contains break-before: page rule', () => {
    const css = buildExportCss({ ...DEFAULT_EXPORT_OPTIONS, pageBreakH1: true })
    expect(css).toContain('break-before: page')
  })

  it('false → does not contain break-before: page', () => {
    const css = buildExportCss({ ...DEFAULT_EXPORT_OPTIONS, pageBreakH1: false })
    expect(css).not.toContain('break-before: page')
  })
})

describe('buildExportCss — presets are distinct', () => {
  it('each preset yields its own body.preset-* selector block', () => {
    const document = buildExportCss({ ...DEFAULT_EXPORT_OPTIONS, preset: 'document' })
    const github = buildExportCss({ ...DEFAULT_EXPORT_OPTIONS, preset: 'github' })
    const compact = buildExportCss({ ...DEFAULT_EXPORT_OPTIONS, preset: 'compact' })

    expect(document).toContain('body.preset-document')
    expect(document).not.toContain('body.preset-github')
    expect(document).not.toContain('body.preset-compact')

    expect(github).toContain('body.preset-github')
    expect(github).not.toContain('body.preset-document')

    expect(compact).toContain('body.preset-compact')
    expect(compact).not.toContain('body.preset-document')

    // All three differ from one another
    expect(document).not.toBe(github)
    expect(github).not.toBe(compact)
    expect(document).not.toBe(compact)
  })
})

describe('buildExportCss — shared print rules always present', () => {
  it('contains break-inside: avoid for pre/table/blockquote/img/figure', () => {
    const css = buildExportCss(DEFAULT_EXPORT_OPTIONS)
    expect(css).toContain('break-inside: avoid')
  })

  it('contains table-header-group for thead', () => {
    const css = buildExportCss(DEFAULT_EXPORT_OPTIONS)
    expect(css).toContain('table-header-group')
  })

  it('contains pre-wrap for pre whitespace handling', () => {
    const css = buildExportCss(DEFAULT_EXPORT_OPTIONS)
    expect(css).toContain('pre-wrap')
  })

  it('is deterministic — same input produces the same output', () => {
    const a = buildExportCss(DEFAULT_EXPORT_OPTIONS)
    const b = buildExportCss(DEFAULT_EXPORT_OPTIONS)
    expect(a).toBe(b)
  })
})

describe('buildExportCss — screen-visible rules live outside @media print', () => {
  it('.url, img, a, and .title-block rules appear before the @media print block', () => {
    const css = buildExportCss(DEFAULT_EXPORT_OPTIONS)
    const printIdx = css.indexOf('@media print')
    expect(printIdx).toBeGreaterThan(-1)

    const urlIdx = css.indexOf('.url {')
    const imgIdx = css.indexOf('img {')
    const titleH1Idx = css.indexOf('.title-block h1')
    const titleDateIdx = css.indexOf('.title-block .date')

    expect(urlIdx).toBeGreaterThan(-1)
    expect(imgIdx).toBeGreaterThan(-1)
    expect(titleH1Idx).toBeGreaterThan(-1)
    expect(titleDateIdx).toBeGreaterThan(-1)

    expect(urlIdx).toBeLessThan(printIdx)
    expect(imgIdx).toBeLessThan(printIdx)
    expect(titleH1Idx).toBeLessThan(printIdx)
    expect(titleDateIdx).toBeLessThan(printIdx)
  })

  it('print-only rules (break-*, table-header-group, pre-wrap) stay inside @media print', () => {
    const css = buildExportCss(DEFAULT_EXPORT_OPTIONS)
    const printIdx = css.indexOf('@media print')
    const breakInsideIdx = css.indexOf('break-inside: avoid')
    const tableHeaderIdx = css.indexOf('table-header-group')
    const preWrapIdx = css.indexOf('pre-wrap')

    expect(breakInsideIdx).toBeGreaterThan(printIdx)
    expect(tableHeaderIdx).toBeGreaterThan(printIdx)
    expect(preWrapIdx).toBeGreaterThan(printIdx)
  })
})
