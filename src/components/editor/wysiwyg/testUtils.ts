/**
 * wysiwyg/testUtils.ts
 *
 * Test helpers for WysiwygEditor-level tests. Provides a headless TipTap
 * Editor whose extension set exactly matches the component's core serialisation
 * config, so test assertions reflect real serialisation behaviour.
 *
 * Export surface
 * ──────────────
 *   buildCoreExtensions(opts)  — returns the StarterKit/Link/Image/Table/
 *                                Markdown/TableInvariant extension array used
 *                                by WysiwygEditor for serialisation tests.
 *   createTestEditor(markdown) — headless Editor pre-loaded with the given
 *                                markdown string, using buildCoreExtensions.
 *   getMarkdown(editor)        — serialises the editor's current document to
 *                                a markdown string via tiptap-markdown storage.
 *
 * Why these helpers exist:
 *   WysiwygEditor.test.tsx and wysiwyg/utils.test.ts previously built their
 *   own extension arrays. Those hand-rolled arrays diverged from the component
 *   config (missing allowBase64, wrong Markdown.configure options, etc.).
 *   All new tests that need a headless editor MUST use createTestEditor so they
 *   break if the config drifts.
 *
 *   buildCoreExtensions and BuildCoreExtensionsOpts are re-exported from
 *   coreExtensions.ts — the single source of truth shared with WysiwygEditor.tsx.
 */

import { Editor } from '@tiptap/core'
import type { MarkdownStorage } from 'tiptap-markdown'
import { buildCoreExtensions } from './coreExtensions'

// Re-export so callers that currently import from testUtils keep working.
export { buildCoreExtensions } from './coreExtensions'
export type { BuildCoreExtensionsOpts } from './coreExtensions'

// ---------------------------------------------------------------------------
// createTestEditor
// ---------------------------------------------------------------------------

/**
 * Creates a headless TipTap Editor loaded with `markdown` using the same
 * extension config as WysiwygEditor's core (serialisation-affecting) set.
 *
 * Call `editor.destroy()` in afterEach to avoid resource leaks.
 */
export function createTestEditor(markdown: string): Editor {
  return new Editor({
    extensions: buildCoreExtensions(),
    content: markdown,
  })
}

// ---------------------------------------------------------------------------
// getMarkdown
// ---------------------------------------------------------------------------

/**
 * Serialises the editor's current ProseMirror document to a markdown string
 * via tiptap-markdown storage.getMarkdown(). Returns '' if not available.
 */
export function getMarkdown(editor: Editor): string {
  if (editor.isDestroyed) return ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const md = (editor.storage as Record<string, any>).markdown as MarkdownStorage | undefined
  if (!md || typeof md.getMarkdown !== 'function') return ''
  return md.getMarkdown()
}
