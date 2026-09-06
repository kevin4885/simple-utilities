/**
 * exportStyles
 *
 * Builds the `<style>` CSS for an exported document (HTML download, rich-text
 * clipboard payload's implicit style-through-fragment is not covered here —
 * only the full document uses this; the fragment relies on inline styles from
 * Prism). Always light colours — export is a standalone document and never
 * reads the app theme, so literal hex values are the deliberate exception to
 * the semantic-token rule used elsewhere in the app.
 */

import type { ExportOptions } from './exportOptions'
// Re-exported so exportStyles.ts satisfies the Shared contract's mention of
// PRESET_LABELS/PAPER_LABELS/MARGIN_LABELS living alongside buildExportCss;
// exportOptions.ts remains the single source of truth for their values.
export { PRESET_LABELS, PAPER_LABELS, MARGIN_LABELS } from './exportOptions'

// ── Shared print-only rules (apply only inside @media print) ──────────────

const PRINT_RULES = `
pre, table, blockquote, img, figure { break-inside: avoid; }
h1, h2, h3 { break-after: avoid; }
thead { display: table-header-group; }
pre { white-space: pre-wrap; word-break: break-word; }
`.trim()

// ── Base reset + common block styling (shared by all presets) ────────────

const BASE_CSS = `
* { box-sizing: border-box; }
body { margin: 0; color: #1a1a1a; background: #fff; }
.doc { max-width: 46em; margin: 0 auto; padding: 2em 1.5em; }
h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.25; margin: 1.4em 0 0.5em; }
h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
p { margin: 0.75em 0; }
ul, ol { margin: 0.75em 0; padding-left: 1.5em; }
li { margin: 0.25em 0; }
hr { border: 0; border-top: 1px solid #d0d7de; margin: 1.5em 0; }
img { display: block; margin: 0.75em 0; max-width: 100%; }
a { color: inherit; text-decoration: underline; }
.url { font-size: 0.85em; color: #555; word-break: break-all; }
.task { font-family: inherit; }

.title-block h1 { border: 0; }
.title-block .date { color: #555; font-size: 0.9em; }

pre {
  background: #f6f8fa;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  padding: 12px;
  font: 0.85em/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-x: auto;
}
pre code {
  font-family: inherit;
  font-size: inherit;
  background: none;
  padding: 0;
  border-radius: 0;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: #f0f1f3;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-size: 0.9em;
}

table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; }
thead th { background: #f6f8fa; }

blockquote {
  border-left: 4px solid #d0d7de;
  color: #57606a;
  padding: 0 1em;
  margin: 1em 0;
}
`.trim()

// ── Per-preset body styling ────────────────────────────────────────────────

const PRESET_CSS: Record<ExportOptions['preset'], string> = {
  document: `
body.preset-document {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 11.5pt;
  line-height: 1.7;
}
body.preset-document .doc { max-width: 42em; }
body.preset-document h1, body.preset-document h2, body.preset-document h3,
body.preset-document h4, body.preset-document h5, body.preset-document h6 {
  font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
}
body.preset-document h1 { font-size: 1.9em; margin-top: 1.8em; }
body.preset-document h2 { font-size: 1.5em; margin-top: 1.6em; }
body.preset-document h3 { font-size: 1.2em; margin-top: 1.4em; }
`.trim(),

  github: `
body.preset-github {
  font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.6;
}
body.preset-github h1, body.preset-github h2 {
  border-bottom: 1px solid #d0d7de;
  padding-bottom: 0.3em;
}
body.preset-github h1 { font-size: 1.8em; }
body.preset-github h2 { font-size: 1.4em; }
body.preset-github h3 { font-size: 1.15em; }
body.preset-github tbody tr:nth-child(2n) { background: #f6f8fa; }
`.trim(),

  compact: `
body.preset-compact {
  font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 9.5pt;
  line-height: 1.4;
}
body.preset-compact .doc { padding: 1em 1em; }
body.preset-compact h1 { font-size: 1.5em; margin: 1em 0 0.3em; }
body.preset-compact h2 { font-size: 1.25em; margin: 0.9em 0 0.3em; }
body.preset-compact h3 { font-size: 1.05em; margin: 0.8em 0 0.25em; }
body.preset-compact p, body.preset-compact ul, body.preset-compact ol { margin: 0.4em 0; }
body.preset-compact pre, body.preset-compact code { font-size: 0.82em; }
`.trim(),
}

// ── @page sizes / margins ──────────────────────────────────────────────────

const PAGE_SIZE: Record<ExportOptions['paper'], string> = {
  letter: 'Letter',
  a4: 'A4',
}

const PAGE_MARGIN: Record<ExportOptions['margins'], string> = {
  normal: '20mm',
  narrow: '10mm',
}

/**
 * Build the complete `<style>` contents for an exported document, given the
 * user's export options. Deterministic — same input always produces the same
 * CSS string (no randomness, no Date).
 */
export function buildExportCss(opts: ExportOptions): string {
  const pageRule = `@page { size: ${PAGE_SIZE[opts.paper]}; margin: ${PAGE_MARGIN[opts.margins]}; }`
  const pageBreakRule = opts.pageBreakH1
    ? 'h1:not(.doc-title):not(:first-child) { break-before: page; }'
    : ''

  return [
    BASE_CSS,
    PRESET_CSS[opts.preset],
    pageRule,
    `@media print {\n${PRINT_RULES}\n}`,
    pageBreakRule,
  ]
    .filter(Boolean)
    .join('\n\n')
}
