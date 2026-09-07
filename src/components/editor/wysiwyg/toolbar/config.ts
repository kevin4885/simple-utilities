/**
 * wysiwyg/toolbar/config.ts
 *
 * Data-driven toolbar configuration. Modelled on gravity-ui WToolbarData.
 *
 * Each ToolbarItem has an exec callback that accepts `(editor, actions)` where
 * actions carries injectable callbacks for link/image/table dialogs. This
 * decoupling is intentional: later phases will swap them out for widgetForm
 * anchored dialogs without touching the config.
 *
 * Usage:
 *   - TOOLBAR_CONFIG  — default toolbar groups rendered by <Toolbar>
 *   - SLASH_ITEMS     — flat list of ToolbarItem derived from TOOLBAR_CONFIG
 *                       (no ToolbarListButton, list items are flattened)
 *                       used as slash-command items by the slash extension.
 */

import type { LucideIcon } from 'lucide-react'
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Pilcrow,
  List,
  ListOrdered,
  ListChecks,
  ListIndentIncrease,
  ListIndentDecrease,
  Link,
  Quote,
  SquareCode,
  Image,
  Table,
  Minus,
  ChevronDown,
} from 'lucide-react'
import type { Editor } from '@tiptap/core'

export type { LucideIcon }
export { ChevronDown }

// ---------------------------------------------------------------------------
// Types (gravity-ui inspired)
// ---------------------------------------------------------------------------

/** Injectable callbacks so exec is not hardcoded to internal popover refs */
export interface ToolbarActions {
  openLink?: () => void
  openImage?: () => void
  openTable?: () => void
}

export interface ToolbarItem {
  id: string
  title: string
  icon: LucideIcon
  /** Display string e.g. 'Ctrl+B' — uses formatHotkey() for Mac vs Win */
  hotkey?: string
  exec: (editor: Editor, actions?: ToolbarActions) => void
  isActive?: (editor: Editor) => boolean
  isEnabled?: (editor: Editor) => boolean
  keywords?: string[]
  description?: string
  /**
   * When true, this item is a "default / reset" option within a
   * ToolbarListButton's dropdown (e.g. "Paragraph" inside the Heading
   * dropdown) and must NOT count toward the parent trigger's `anyActive`
   * highlight. The item can still be highlighted for itself inside the
   * open dropdown menu — this only excludes it from the group's OR check.
   */
  excludeFromGroupActive?: boolean
}

export interface ToolbarListButton {
  id: string
  title: string
  icon: LucideIcon
  type: 'list'
  items: ToolbarItem[]
}

export type ToolbarGroup = (ToolbarItem | ToolbarListButton)[]
export type ToolbarConfig = ToolbarGroup[]

// ---------------------------------------------------------------------------
// Platform-aware hotkey formatter
// ---------------------------------------------------------------------------

/**
 * Returns a display string for a hotkey, using Cmd on Mac and Ctrl elsewhere.
 * Always returns the Ctrl variant in non-browser environments (SSR / tests).
 */
export function formatHotkey(pattern: string): string {
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
  return isMac ? pattern.replace(/Ctrl\+/g, 'Cmd+') : pattern
}

// ---------------------------------------------------------------------------
// Default toolbar config
// ---------------------------------------------------------------------------

export const TOOLBAR_CONFIG: ToolbarConfig = [
  // Group 0 — History
  [
    {
      id: 'undo',
      title: 'Undo',
      icon: Undo2,
      hotkey: 'Ctrl+Z',
      exec: (editor) => editor.chain().focus().undo().run(),
      isEnabled: (editor) => editor.can().undo(),
    },
    {
      id: 'redo',
      title: 'Redo',
      icon: Redo2,
      hotkey: 'Ctrl+Shift+Z',
      exec: (editor) => editor.chain().focus().redo().run(),
      isEnabled: (editor) => editor.can().redo(),
    },
  ],

  // Group 1 — Inline marks
  [
    {
      id: 'bold',
      title: 'Bold',
      icon: Bold,
      hotkey: 'Ctrl+B',
      exec: (editor) => editor.chain().focus().toggleBold().run(),
      isActive: (editor) => editor.isActive('bold'),
      isEnabled: (editor) => editor.can().toggleBold(),
      keywords: ['bold', 'strong', '**'],
      description: 'Bold text',
    },
    {
      id: 'italic',
      title: 'Italic',
      icon: Italic,
      hotkey: 'Ctrl+I',
      exec: (editor) => editor.chain().focus().toggleItalic().run(),
      isActive: (editor) => editor.isActive('italic'),
      isEnabled: (editor) => editor.can().toggleItalic(),
      keywords: ['italic', 'em', '*', '_'],
      description: 'Italic text',
    },
    {
      id: 'strike',
      title: 'Strikethrough',
      icon: Strikethrough,
      hotkey: 'Ctrl+Shift+S',
      exec: (editor) => editor.chain().focus().toggleStrike().run(),
      isActive: (editor) => editor.isActive('strike'),
      isEnabled: (editor) => editor.can().toggleStrike(),
      keywords: ['strike', 'strikethrough', '~~'],
      description: 'Strikethrough text',
    },
    {
      id: 'inlineCode',
      title: 'Inline Code',
      icon: Code,
      hotkey: 'Ctrl+E',
      exec: (editor) => editor.chain().focus().toggleCode().run(),
      isActive: (editor) => editor.isActive('code'),
      isEnabled: (editor) => editor.can().toggleCode(),
      keywords: ['code', 'inline', '`', 'monospace'],
      description: 'Inline code span',
    },
  ],

  // Group 2 — Block structure
  [
    {
      id: 'heading',
      title: 'Heading',
      icon: Heading,
      type: 'list',
      items: [
        {
          id: 'paragraph',
          title: 'Paragraph',
          icon: Pilcrow,
          hotkey: 'Ctrl+Alt+0',
          exec: (editor) => editor.chain().focus().setParagraph().run(),
          isActive: (editor) => editor.isActive('paragraph'),
          excludeFromGroupActive: true,
          keywords: ['paragraph', 'normal', 'p'],
          description: 'Normal paragraph',
        },
        {
          id: 'heading1',
          title: 'Heading 1',
          icon: Heading1,
          hotkey: 'Ctrl+Alt+1',
          exec: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
          isActive: (editor) => editor.isActive('heading', { level: 1 }),
          keywords: ['h1', 'heading', 'title', '#'],
          description: 'Large section heading',
        },
        {
          id: 'heading2',
          title: 'Heading 2',
          icon: Heading2,
          hotkey: 'Ctrl+Alt+2',
          exec: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
          isActive: (editor) => editor.isActive('heading', { level: 2 }),
          keywords: ['h2', 'heading', 'subtitle', '##'],
          description: 'Medium section heading',
        },
        {
          id: 'heading3',
          title: 'Heading 3',
          icon: Heading3,
          hotkey: 'Ctrl+Alt+3',
          exec: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
          isActive: (editor) => editor.isActive('heading', { level: 3 }),
          keywords: ['h3', 'heading', '###'],
          description: 'Small section heading',
        },
        {
          id: 'heading4',
          title: 'Heading 4',
          icon: Heading4,
          hotkey: 'Ctrl+Alt+4',
          exec: (editor) => editor.chain().focus().toggleHeading({ level: 4 }).run(),
          isActive: (editor) => editor.isActive('heading', { level: 4 }),
          keywords: ['h4', 'heading'],
          description: 'Heading level 4',
        },
        {
          id: 'heading5',
          title: 'Heading 5',
          icon: Heading5,
          hotkey: 'Ctrl+Alt+5',
          exec: (editor) => editor.chain().focus().toggleHeading({ level: 5 }).run(),
          isActive: (editor) => editor.isActive('heading', { level: 5 }),
          keywords: ['h5', 'heading'],
          description: 'Heading level 5',
        },
        {
          id: 'heading6',
          title: 'Heading 6',
          icon: Heading6,
          hotkey: 'Ctrl+Alt+6',
          exec: (editor) => editor.chain().focus().toggleHeading({ level: 6 }).run(),
          isActive: (editor) => editor.isActive('heading', { level: 6 }),
          keywords: ['h6', 'heading'],
          description: 'Heading level 6',
        },
      ],
    } as ToolbarListButton,
    {
      id: 'list',
      title: 'List',
      icon: List,
      type: 'list',
      items: [
        {
          id: 'bulletList',
          title: 'Bullet List',
          icon: List,
          hotkey: 'Ctrl+Shift+8',
          exec: (editor) => editor.chain().focus().toggleBulletList().run(),
          isActive: (editor) => editor.isActive('bulletList'),
          keywords: ['ul', 'bullet', 'list', 'unordered', '-', '*'],
          description: 'Unordered list',
        },
        {
          id: 'orderedList',
          title: 'Numbered List',
          icon: ListOrdered,
          hotkey: 'Ctrl+Shift+7',
          exec: (editor) => editor.chain().focus().toggleOrderedList().run(),
          isActive: (editor) => editor.isActive('orderedList'),
          keywords: ['ol', 'numbered', 'ordered', 'list', '1.'],
          description: 'Ordered list',
        },
        {
          id: 'taskList',
          title: 'Task List',
          icon: ListChecks,
          exec: (editor) => editor.chain().focus().toggleTaskList().run(),
          isActive: (editor) => editor.isActive('taskList'),
          keywords: ['task', 'todo', 'checkbox', 'check', '[ ]'],
          description: 'Checkbox / todo list',
        },
        {
          id: 'indentIncrease',
          title: 'Increase Indent',
          icon: ListIndentIncrease,
          exec: (editor) => editor.chain().focus().sinkListItem('listItem').run(),
          isEnabled: (editor) => editor.can().sinkListItem('listItem'),
          keywords: ['indent', 'increase', 'sink'],
          description: 'Increase list indent',
        },
        {
          id: 'indentDecrease',
          title: 'Decrease Indent',
          icon: ListIndentDecrease,
          exec: (editor) => editor.chain().focus().liftListItem('listItem').run(),
          isEnabled: (editor) => editor.can().liftListItem('listItem'),
          keywords: ['outdent', 'decrease', 'lift'],
          description: 'Decrease list indent',
        },
      ],
    } as ToolbarListButton,
    {
      id: 'link',
      title: 'Link',
      icon: Link,
      hotkey: 'Ctrl+K',
      exec: (_editor, actions) => actions?.openLink?.(),
      isActive: (editor) => editor.isActive('link'),
      keywords: ['link', 'href', 'url', 'a', 'anchor'],
      description: 'Insert a hyperlink (Ctrl+K)',
    },
    {
      id: 'blockquote',
      title: 'Blockquote',
      icon: Quote,
      hotkey: 'Ctrl+Shift+B',
      exec: (editor) => editor.chain().focus().toggleBlockquote().run(),
      isActive: (editor) => editor.isActive('blockquote'),
      isEnabled: (editor) => editor.can().toggleBlockquote(),
      keywords: ['quote', 'blockquote', '>'],
      description: 'Indented block quote',
    },
    {
      id: 'code',
      title: 'Code',
      icon: SquareCode,
      type: 'list',
      items: [
        {
          id: 'inlineCode2',
          title: 'Inline Code',
          icon: Code,
          hotkey: 'Ctrl+E',
          exec: (editor) => editor.chain().focus().toggleCode().run(),
          isActive: (editor) => editor.isActive('code'),
          keywords: ['code', 'inline', '`'],
          description: 'Inline code span',
        },
        {
          id: 'codeBlock',
          title: 'Code Block',
          icon: SquareCode,
          hotkey: 'Ctrl+Alt+C',
          exec: (editor) => editor.chain().focus().toggleCodeBlock().run(),
          isActive: (editor) => editor.isActive('codeBlock'),
          keywords: ['code', 'codeblock', 'fence', '```', 'pre'],
          description: 'Fenced code block',
        },
      ],
    } as ToolbarListButton,
  ],

  // Group 3 — Insert
  [
    {
      id: 'image',
      title: 'Image',
      icon: Image,
      exec: (_editor, actions) => actions?.openImage?.(),
      keywords: ['image', 'img', 'picture', 'photo', '![]'],
      description: 'Insert an image by URL',
    },
    {
      id: 'table',
      title: 'Table',
      icon: Table,
      exec: (_editor, actions) => actions?.openTable?.(),
      keywords: ['table', 'grid', '|'],
      description: 'Insert a table (grid picker)',
    },
    {
      id: 'horizontalRule',
      title: 'Horizontal Rule',
      icon: Minus,
      exec: (editor) => editor.chain().focus().setHorizontalRule().run(),
      keywords: ['hr', 'rule', 'divider', '---', 'separator'],
      description: 'Divider / separator line',
    },
  ],
]

// ---------------------------------------------------------------------------
// SLASH_ITEMS — flat list of ToolbarItem for slash commands
// Derived from TOOLBAR_CONFIG: list buttons are flattened, non-list items
// are included directly. Duplicate ids (inlineCode vs inlineCode2) are
// deduplicated — inlineCode from marks group is preferred.
// ---------------------------------------------------------------------------

function flattenConfig(config: ToolbarConfig): ToolbarItem[] {
  const seen = new Set<string>()
  const result: ToolbarItem[] = []

  for (const group of config) {
    for (const entry of group) {
      if ('type' in entry && entry.type === 'list') {
        for (const item of entry.items) {
          if (!seen.has(item.id)) {
            seen.add(item.id)
            result.push(item)
          }
        }
      } else {
        const item = entry as ToolbarItem
        // Skip undo/redo from slash menu — not useful as slash commands
        if (item.id === 'undo' || item.id === 'redo') continue
        if (!seen.has(item.id)) {
          seen.add(item.id)
          result.push(item)
        }
      }
    }
  }

  return result
}

export const SLASH_ITEMS: ToolbarItem[] = flattenConfig(TOOLBAR_CONFIG)

// ---------------------------------------------------------------------------
// HEADING_ITEMS — the paragraph + h1-h6 items from the heading list button
// Exported for use by SelectionBubble (avoids positional indexing into TOOLBAR_CONFIG)
// ---------------------------------------------------------------------------

const headingListEntry = TOOLBAR_CONFIG[2]?.[0]
export const HEADING_ITEMS: ToolbarItem[] =
  headingListEntry &&
  'type' in headingListEntry &&
  (headingListEntry as ToolbarListButton).type === 'list'
    ? (headingListEntry as ToolbarListButton).items
    : []
