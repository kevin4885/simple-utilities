/**
 * Visual Markdown Editor — pure logic functions
 *
 * All functions here are pure (no React, no side-effects) so they are trivial
 * to unit-test and can be imported anywhere without bundle concerns.
 *
 * Token counting and text statistics are shared with (re-exported from) the
 * markdown-editor logic to avoid duplication. Version helpers are local.
 */

// Re-export shared helpers from the sibling markdown-editor so both tools
// stay in sync without duplicating code.
export {
  countTokensGpt,
  countTokensApprox,
  countWords,
  countChars,
  countLines,
  generateDocTitle,
  pruneAutoVersions,
  formatVersionTime,
  AUTO_VERSION_CAP,
} from '../markdown-editor/logic'

// ---------------------------------------------------------------------------
// VME-specific helpers
// ---------------------------------------------------------------------------

/**
 * Derive a display mode label for the three-way mode toggle.
 * Returns the human-readable label for each mode id.
 */
export function getModeLabel(mode: 'wysiwyg' | 'markdown' | 'preview'): string {
  switch (mode) {
    case 'wysiwyg':   return 'Visual'
    case 'markdown':  return 'Markdown'
    case 'preview':   return 'Preview'
  }
}

/**
 * Sanitise a filename for download: replace non-alphanumeric chars with
 * hyphens, collapse runs, strip leading/trailing hyphens.
 */
export function toSafeFilename(title: string): string {
  return title
    .replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

/**
 * Build palette item groups for the component palette panel.
 * Returns a stable array — safe to use as default for useMemo deps.
 */
export interface PaletteItem {
  label: string
  description: string
  icon: string
  /** Markdown snippet to insert at cursor */
  snippet: string
}

export interface PaletteGroup {
  group: string
  items: PaletteItem[]
}

export const PALETTE_GROUPS: PaletteGroup[] = [
  {
    group: 'Headings',
    items: [
      { label: 'Heading 1', description: 'H1 — main title', icon: 'H1', snippet: '# Heading 1\n' },
      { label: 'Heading 2', description: 'H2 — section', icon: 'H2', snippet: '## Heading 2\n' },
      { label: 'Heading 3', description: 'H3 — sub-section', icon: 'H3', snippet: '### Heading 3\n' },
      { label: 'Heading 4', description: 'H4', icon: 'H4', snippet: '#### Heading 4\n' },
      { label: 'Heading 5', description: 'H5', icon: 'H5', snippet: '##### Heading 5\n' },
      { label: 'Heading 6', description: 'H6', icon: 'H6', snippet: '###### Heading 6\n' },
    ],
  },
  {
    group: 'Text',
    items: [
      { label: 'Bold',          description: '**bold**',           icon: 'B',  snippet: '**bold text**' },
      { label: 'Italic',        description: '*italic*',           icon: 'I',  snippet: '*italic text*' },
      { label: 'Strikethrough', description: '~~strike~~',         icon: 'S̶', snippet: '~~strikethrough~~' },
      { label: 'Inline Code',   description: '`code`',            icon: '`',  snippet: '`inline code`' },
      { label: 'Link',          description: '[text](url)',        icon: '🔗', snippet: '[link text](https://example.com)' },
    ],
  },
  {
    group: 'Blocks',
    items: [
      { label: 'Paragraph',      description: 'Plain paragraph',   icon: '¶',   snippet: 'Paragraph text.\n' },
      { label: 'Blockquote',     description: '> quote',           icon: '❝',   snippet: '> Blockquote text\n' },
      { label: 'Code Block',     description: 'Fenced code block', icon: '</>', snippet: '```\ncode here\n```\n' },
      { label: 'Horizontal Rule',description: '---',               icon: '—',   snippet: '\n---\n' },
    ],
  },
  {
    group: 'Lists',
    items: [
      { label: 'Bullet List',  description: 'Unordered list',  icon: '•',  snippet: '- Item 1\n- Item 2\n- Item 3\n' },
      { label: 'Ordered List', description: 'Numbered list',   icon: '1.', snippet: '1. Item 1\n2. Item 2\n3. Item 3\n' },
      { label: 'Task List',    description: 'Checkbox list',   icon: '☑',  snippet: '- [ ] Task 1\n- [x] Done task\n- [ ] Task 3\n' },
    ],
  },
  {
    group: 'Table',
    items: [
      {
        label: '3×3 Table',
        description: 'Table with header',
        icon: '⊞',
        snippet:
          '| Header 1 | Header 2 | Header 3 |\n' +
          '| --- | --- | --- |\n' +
          '| Cell 1 | Cell 2 | Cell 3 |\n' +
          '| Cell 4 | Cell 5 | Cell 6 |\n',
      },
    ],
  },
  {
    group: 'Media',
    items: [
      {
        label: 'Image',
        description: '![alt](url)',
        icon: '🖼',
        snippet: '![Image description](https://example.com/image.png)\n',
      },
    ],
  },
]
