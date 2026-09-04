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
 * Tuple of all valid editor mode ids — single source of truth.
 * store.ts derives EditorModeSchema from this via z.enum(EDITOR_MODE_IDS).
 * Adding a mode: add one entry here, one EditorModeMeta row in EDITOR_MODES,
 * and one icon entry in index.tsx's modeIcons map.
 */
export const EDITOR_MODE_IDS = ['wysiwyg', 'markdown', 'preview', 'split'] as const

/** Union type derived from EDITOR_MODE_IDS — no duplication with store.ts. */
export type EditorModeId = typeof EDITOR_MODE_IDS[number]

export interface EditorModeMeta {
  id: EditorModeId
  /** Short label shown next to the icon in the mode toggle. */
  label: string
  /** Tooltip / title text for the mode toggle button. */
  title: string
}

/**
 * Single source of truth for the four-way mode toggle (order = display order).
 * Icons live in index.tsx (this file stays React-free); everything else
 * about a mode is defined here.
 */
export const EDITOR_MODES: readonly EditorModeMeta[] = [
  { id: 'wysiwyg',  label: 'Visual',   title: 'Visual editor' },
  { id: 'markdown', label: 'Markdown', title: 'Markdown source' },
  { id: 'preview',  label: 'Preview',  title: 'Preview' },
  { id: 'split',    label: 'Split',    title: 'Split view (markdown | preview)' },
]

/** Human-readable label for a mode id. */
export function getModeLabel(mode: EditorModeId): string {
  return EDITOR_MODES.find((m) => m.id === mode)?.label ?? mode
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
 *   @tiptap/extension-list ListItem — Tab (sinkListItem), Shift-Tab (liftListItem)
 *   linkKeyboard extension          — Mod-k, Mod-Shift-k
 *   linkKeyboard extension (table)  — Mod-Enter, Mod-Shift-Enter,
 *                                     Mod-Alt-←/→/Backspace
 *   undo/redo                       — Ctrl+Z / Ctrl+Shift+Z (StarterKit UndoRedo)
 *   VME page                        — Ctrl+Alt+P toggles preview (replaces Ctrl+Shift+P
 *                                     which is Firefox's non-preventable New Private Window)
 */
export const KEYBOARD_SHORTCUTS: ShortcutEntry[] = [
  // ── Text formatting ─────────────────────────────────────────────────────
  { category: 'Formatting', keys: 'Ctrl+B / Cmd+B',           description: 'Bold' },
  { category: 'Formatting', keys: 'Ctrl+I / Cmd+I',           description: 'Italic' },
  { category: 'Formatting', keys: 'Ctrl+Shift+S',             description: 'Strikethrough' },
  { category: 'Formatting', keys: 'Ctrl+E / Cmd+E',           description: 'Inline code' },
  { category: 'Formatting', keys: 'Ctrl+Shift+B',             description: 'Blockquote' },
  { category: 'Formatting', keys: 'Ctrl+Alt+C',               description: 'Code block' },
  // ── History ─────────────────────────────────────────────────────────────
  { category: 'History',    keys: 'Ctrl+Z / Cmd+Z',           description: 'Undo' },
  { category: 'History',    keys: 'Ctrl+Shift+Z / Cmd+Shift+Z', description: 'Redo' },
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
  // Tab/Shift+Tab indent: verified in @tiptap/extension-list ListItem source
  // (ListItem.addKeyboardShortcuts: Tab → sinkListItem, Shift-Tab → liftListItem)
  { category: 'Lists',      keys: 'Tab',                       description: 'Indent list item (inside list)' },
  { category: 'Lists',      keys: 'Shift+Tab',                 description: 'Outdent list item (inside list)' },
  // ── Links ───────────────────────────────────────────────────────────────
  { category: 'Links',      keys: 'Ctrl+K / Cmd+K',           description: 'Insert / edit link' },
  { category: 'Links',      keys: 'Ctrl+Shift+K',             description: 'Remove link (unlink)' },
  // ── Tables ──────────────────────────────────────────────────────────────
  { category: 'Tables',     keys: 'Tab',                       description: 'Move to next cell (adds row at last cell)' },
  { category: 'Tables',     keys: 'Enter',                     description: 'Move to cell below (adds row when in last row)' },
  { category: 'Tables',     keys: 'Shift+Enter',               description: 'No-op in a table cell (GFM cells cannot contain line breaks; hardBreak prevented by priority:1000 keymap guard)' },
  { category: 'Tables',     keys: 'Ctrl+Enter',                description: 'Add row below' },
  { category: 'Tables',     keys: 'Ctrl+Shift+Enter',          description: 'Add row above' },
  { category: 'Tables',     keys: 'Ctrl+Alt+→',               description: 'Add column after' },
  { category: 'Tables',     keys: 'Ctrl+Alt+←',               description: 'Add column before' },
  { category: 'Tables',     keys: 'Ctrl+Alt+Backspace',        description: 'Delete row' },
  // ── View ────────────────────────────────────────────────────────────────
  { category: 'View',       keys: 'Ctrl+Alt+P / Cmd+Alt+P', description: 'Toggle Preview mode (returns to previous mode)' },
  // ── Selection toolbar ────────────────────────────────────────────────────
  { category: 'Selection',  keys: 'Select text',               description: 'Show inline formatting toolbar (bold, italic, link…)' },
  // ── Table controls ───────────────────────────────────────────────────────
  { category: 'Selection',  keys: 'Hover a table row/column',  description: 'Show row/column handle menu (insert, delete, move)' },
  // ── Popups / menus ───────────────────────────────────────────────────────
  { category: 'Commands',   keys: '/',                         description: 'Open slash-command menu' },
  { category: 'Commands',   keys: 'Escape',                    description: 'Close any open popup or menu' },
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
