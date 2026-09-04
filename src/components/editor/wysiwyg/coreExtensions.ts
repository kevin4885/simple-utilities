/**
 * wysiwyg/coreExtensions.ts
 *
 * Single source of truth for the WYSIWYG editor's serialisation-relevant
 * extensions. Both WysiwygEditor.tsx (production) and testUtils.ts (tests)
 * import from here, so there is no risk of the two lists diverging.
 *
 * "Core" = every extension that affects how markdown is parsed or serialised,
 * plus the tableInvariant plugin that enforces the GFM header-row invariant.
 * It deliberately excludes extensions that depend on React refs or UI state:
 *   • Placeholder      — needs a ref for live-update support
 *   • slashCommand     — needs setMenuRef / slashHandleRef / opener refs
 *   • linkKeyboard     — needs openLinkRef
 *   • widgetForm       — ProseMirror plugin with in-doc decorations
 *   • tableControls    — hover/focus tracking plugin with DOM events
 *
 * Usage (WysiwygEditor.tsx):
 *   const extensions = useMemo(
 *     () => [...buildCoreExtensions(), Placeholder.configure(…), slashExtension, …],
 *     [minimal],
 *   )
 *
 * Usage (testUtils.ts / tests):
 *   const editor = new Editor({ extensions: buildCoreExtensions(), content: md })
 */

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
import { tableInvariantExtension } from './extensions/tableInvariant'
import type { Extensions } from '@tiptap/core'

export interface BuildCoreExtensionsOpts {
  /**
   * Enables base64 image support (allowBase64: true on the Image extension).
   * Required so data-URI images survive the parse → serialise round-trip.
   * Defaults to true (matches the production component).
   */
  allowBase64?: boolean
}

/**
 * Returns the core extension array used by WysiwygEditor for parsing and
 * serialisation. Append only ref/UI-dependent extensions on top of this.
 */
export function buildCoreExtensions(opts: BuildCoreExtensionsOpts = {}): Extensions {
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
    tableInvariantExtension,
  ]
}
