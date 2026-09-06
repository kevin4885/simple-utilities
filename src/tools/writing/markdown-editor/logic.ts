/**
 * Markdown Editor — pure logic functions
 *
 * All functions here are pure (no React, no side-effects) so they are trivial
 * to unit-test and can be imported anywhere without bundle concerns.
 *
 * VME = legacy internal prefix (this tool started life as the "Visual Markdown
 * Editor", consolidated with the old CodeMirror-only "Markdown Editor" tool —
 * see STORAGE_KEY / LEGACY_STORAGE_KEY / migrateLegacyStorage below). Internal
 * identifiers keep the Vme* prefix; only user-facing names, ids, paths and the
 * storage key changed.
 */

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

/** Label applied to the automatic snapshot saved just before a restore. */
export const RESTORE_SNAPSHOT_LABEL = 'Before restore'

/** Maximum number of automatic "Before restore" snapshots to retain per document. */
export const RESTORE_SNAPSHOT_CAP = 5

/** Minimal shape required by pruneRestoreSnapshots (avoids circular dep with store). */
interface HasLabelAndAuto {
  label?: string
  auto: boolean
}

/**
 * Prune excess automatic "Before restore" snapshots from a newest-first
 * ordered array. Only entries with `label === RESTORE_SNAPSHOT_LABEL && auto
 * === false` are counted and subject to pruning — every other version
 * (including a "Before restore" snapshot the user has since renamed, which
 * no longer matches the label) is left untouched. Original array ordering
 * is preserved.
 */
export function pruneRestoreSnapshots<T extends HasLabelAndAuto>(
  versions: T[],
  cap = RESTORE_SNAPSHOT_CAP,
): T[] {
  let snapshotCount = 0
  return versions.filter((v) => {
    if (v.label !== RESTORE_SNAPSHOT_LABEL || v.auto) return true // not a restore snapshot — always keep
    snapshotCount++
    return snapshotCount <= cap
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
// Storage keys & legacy migration
// ---------------------------------------------------------------------------

/** Current localStorage key for the Markdown Editor's persisted store. */
export const STORAGE_KEY = 'su:markdown-editor'

/** Former key, used by the old "Visual Markdown Editor" tool before consolidation. */
export const LEGACY_STORAGE_KEY = 'su:visual-markdown-editor'

/** Minimal storage shape the migration needs — matches the subset of `Storage` it touches. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * One-time move of the persisted VME state from the legacy key to STORAGE_KEY.
 * Overwrites whatever is under STORAGE_KEY (old CodeMirror editor data — intentionally discarded).
 * The legacy key is only removed after the write to STORAGE_KEY succeeds, so a
 * failing write never loses the legacy data. Any storage error is swallowed and
 * reported as a no-op.
 */
export function migrateLegacyStorage(storage: StorageLike): 'migrated' | 'noop' {
  try {
    const legacy = storage.getItem(LEGACY_STORAGE_KEY)
    if (legacy === null) return 'noop'
    storage.setItem(STORAGE_KEY, legacy)
    storage.removeItem(LEGACY_STORAGE_KEY)
    return 'migrated'
  } catch {
    return 'noop'
  }
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
