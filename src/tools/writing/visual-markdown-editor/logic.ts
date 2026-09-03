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

// ---------------------------------------------------------------------------
// Keyboard shortcuts list (used by ShortcutsDialog for discoverability)
// ---------------------------------------------------------------------------

export interface ShortcutEntry {
  /** Platform-neutral display string, e.g. "Ctrl+B / Cmd+B" */
  keys: string
  description: string
  category: string
}

/**
 * Complete keyboard shortcut reference for the Visual Markdown Editor.
 *
 * Only shortcuts that are actually bound in the current TipTap v3 setup are
 * listed. Verified against installed packages:
 *   @tiptap/extension-bold          — Mod-b
 *   @tiptap/extension-italic        — Mod-i
 *   @tiptap/extension-strike        — Mod-Shift-s (StarterKit)
 *   @tiptap/extension-code          — Mod-e
 *   @tiptap/extension-blockquote    — Mod-Shift-b (StarterKit)
 *   @tiptap/extension-code-block    — Mod-Alt-c (StarterKit)
 *   @tiptap/extension-heading       — Mod-Alt-1 through Mod-Alt-6 (StarterKit)
 *   @tiptap/extension-list (via StarterKit BulletList)  — Mod-Shift-8
 *   @tiptap/extension-list (via StarterKit OrderedList) — Mod-Shift-7
 *   @tiptap/extension-task-list     — no keyboard shortcut bound by default
 *   linkKeyboard extension          — Mod-k, Mod-Shift-k
 *   linkKeyboard extension (table)  — Mod-Enter, Mod-Shift-Enter,
 *                                     Mod-Alt-←/→/Backspace
 */
export const KEYBOARD_SHORTCUTS: ShortcutEntry[] = [
  // ── Text formatting ─────────────────────────────────────────────────────
  { category: 'Formatting', keys: 'Ctrl+B / Cmd+B',           description: 'Bold' },
  { category: 'Formatting', keys: 'Ctrl+I / Cmd+I',           description: 'Italic' },
  { category: 'Formatting', keys: 'Ctrl+Shift+S',             description: 'Strikethrough' },
  { category: 'Formatting', keys: 'Ctrl+E / Cmd+E',           description: 'Inline code' },
  { category: 'Formatting', keys: 'Ctrl+Shift+B',             description: 'Blockquote' },
  { category: 'Formatting', keys: 'Ctrl+Alt+C',               description: 'Code block' },
  // ── Headings ────────────────────────────────────────────────────────────
  { category: 'Headings',   keys: 'Ctrl+Alt+1',               description: 'Heading 1' },
  { category: 'Headings',   keys: 'Ctrl+Alt+2',               description: 'Heading 2' },
  { category: 'Headings',   keys: 'Ctrl+Alt+3',               description: 'Heading 3' },
  { category: 'Headings',   keys: 'Ctrl+Alt+4',               description: 'Heading 4' },
  { category: 'Headings',   keys: 'Ctrl+Alt+5',               description: 'Heading 5' },
  { category: 'Headings',   keys: 'Ctrl+Alt+6',               description: 'Heading 6' },
  // ── Lists ────────────────────────────────────────────────────────────────
  { category: 'Lists',      keys: 'Ctrl+Shift+8',             description: 'Bullet list' },
  { category: 'Lists',      keys: 'Ctrl+Shift+7',             description: 'Ordered list' },
  // ── Links ───────────────────────────────────────────────────────────────
  { category: 'Links',      keys: 'Ctrl+K / Cmd+K',           description: 'Insert / edit link' },
  { category: 'Links',      keys: 'Ctrl+Shift+K',             description: 'Remove link (unlink)' },
  // ── Tables ──────────────────────────────────────────────────────────────
  { category: 'Tables',     keys: 'Tab',                       description: 'Move to next cell (adds row at last cell)' },
  { category: 'Tables',     keys: 'Ctrl+Enter',                description: 'Add row below' },
  { category: 'Tables',     keys: 'Ctrl+Shift+Enter',          description: 'Add row above' },
  { category: 'Tables',     keys: 'Ctrl+Alt+→',               description: 'Add column after' },
  { category: 'Tables',     keys: 'Ctrl+Alt+←',               description: 'Add column before' },
  { category: 'Tables',     keys: 'Ctrl+Alt+Backspace',        description: 'Delete row' },
  // ── Slash commands ───────────────────────────────────────────────────────
  { category: 'Commands',   keys: '/',                         description: 'Open slash-command menu' },
  // ── Markdown auto-conversion (input rules) ───────────────────────────────
  { category: 'Auto',       keys: '# ',                        description: 'Heading 1' },
  { category: 'Auto',       keys: '## ',                       description: 'Heading 2' },
  { category: 'Auto',       keys: '### ',                      description: 'Heading 3' },
  { category: 'Auto',       keys: '- or * ',                   description: 'Bullet list' },
  { category: 'Auto',       keys: '1. ',                       description: 'Ordered list' },
  { category: 'Auto',       keys: '[ ] ',                      description: 'Task list item' },
  { category: 'Auto',       keys: '> ',                        description: 'Blockquote' },
  { category: 'Auto',       keys: '``` ',                      description: 'Code block' },
  { category: 'Auto',       keys: '--- ',                      description: 'Horizontal rule' },
  { category: 'Auto',       keys: '[text](url) ',              description: 'Convert to link' },
]
