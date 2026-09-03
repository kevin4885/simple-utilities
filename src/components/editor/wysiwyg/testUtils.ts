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
 *                                Markdown/TaskList extension array used by
 *                                WysiwygEditor for serialisation tests.
 *   createTestEditor(markdown) — headless Editor pre-loaded with the given
 *                                markdown string, using buildCoreExtensions.
 *   getMarkdown(editor)        — serialises the editor's current document to
 *                                a markdown string via tiptap-markdown storage.
 *
 * ⚠ Do NOT import this file in production code — it is only for Vitest.
 *
 * Why these helpers exist:
 *   WysiwygEditor.test.tsx and wysiwyg/utils.test.ts previously built their
 *   own extension arrays. Those hand-rolled arrays diverged from the component
 *   config (missing allowBase64, wrong Markdown.configure options, etc.).
 *   All new tests that need a headless editor MUST use createTestEditor so they
 *   break if the config drifts.
 */

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Link } from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import type { MarkdownStorage } from 'tiptap-markdown'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface BuildCoreExtensionsOpts {
  /**
   * When true, enables base64 image support (allowBase64: true on the Image
   * extension). Should always be true — mirrors the component default.
   * Defaults to true.
   */
  allowBase64?: boolean
}

// ---------------------------------------------------------------------------
// buildCoreExtensions
// ---------------------------------------------------------------------------

/**
 * Returns the core extension set for serialisation tests.
 * These are the extensions that control how markdown is parsed/serialised.
 * Matches WysiwygEditor.tsx exactly (no ref-dependent extensions like slash,
 * linkKeyboard, widgetForm, tableControls which have no serialisation effect).
 */
export function buildCoreExtensions(opts: BuildCoreExtensionsOpts = {}) {
  const { allowBase64 = true } = opts
  return [
    StarterKit.configure({
      undoRedo: { depth: 200 },
      codeBlock: { HTMLAttributes: { class: 'wysiwyg-code-block' } },
      link: false,
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList.configure({
      HTMLAttributes: { class: 'wysiwyg-task-list' },
    }),
    TaskItem.configure({ nested: true }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: {
        class: 'wysiwyg-link',
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    }),
    Image.configure({
      allowBase64,
      HTMLAttributes: { class: 'wysiwyg-image max-w-full rounded' },
    }),
    Markdown.configure({
      html: false,
      tightLists: true,
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: false,
    }),
  ]
}

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
