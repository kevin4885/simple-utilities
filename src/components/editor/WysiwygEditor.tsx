/**
 * WysiwygEditor — embeddable TipTap WYSIWYG editor for markdown
 *
 * A standalone, reusable React component. Single source of truth is a
 * markdown string (value prop); the editor parses it to a ProseMirror doc on
 * mount / external value change and serialises back to markdown on every edit.
 *
 * Markdown library choice: tiptap-markdown (0.9.x, targets Tiptap v3).
 * It wraps prosemirror-markdown and adds GFM tables + task-list serialisation.
 * If it becomes unmaintained the fallback is prosemirror-markdown's
 * defaultMarkdownSerializer wrapped in a custom TipTap extension.
 *
 * Slash menu: implemented as a React portal + custom Suggestion extension.
 * No tippy.js — uses a simple absolute-positioned div anchored to the cursor
 * DOMRect. @floating-ui/dom is available as a transitive dep but not needed.
 *
 * BUBBLE MENUS (BubbleMenu from @tiptap/react/menus):
 *   Two bubble menus remain (image and table); the link bubble has been removed.
 *   Only one can show at a time, gated by precise shouldShow callbacks:
 *     1. ImageBubble — when image node is selected
 *     2. TableBubble — when cursor is inside a table (and no image selected)
 *
 *   Link editing is keyboard-first via Ctrl+K / Cmd+K.
 *
 * URL normalisation: normalizeUrl() (src/components/editor/wysiwyg-utils.ts)
 *   prepends https:// to bare domains; leaves mailto:, #anchors, data: URIs,
 *   relative paths, and URLs that already have a scheme untouched.
 *
 * Props
 * ─────
 *   value              — markdown string (single source of truth)
 *   onChange           — called with new markdown (debounced; see below)
 *   placeholder        — placeholder text when empty
 *   readOnly           — disables editing
 *   className          — extra wrapper classes
 *   minimal            — when true: no slash menu; pure keyboard surface for
 *                        inline embedding. Ctrl+K, input rules, image/table
 *                        bubbles still work in minimal mode.
 *   onChangeDebounceMs — debounce delay for onChange (default 150; 0 = sync)
 *   ref (forwarded)    — exposes { flush(): void } to flush pending onChange
 *                        immediately (call before switching modes).
 *
 * Performance
 * ───────────
 *   • lastEmittedMd ref: skips getMarkdown() in the sync-effect when the
 *     value prop equals what was last emitted (i.e. our own edit round-trip).
 *   • Debounced emit: onChange is called after 150 ms idle (not per keystroke).
 *     Flush is called synchronously on: blur, readOnly flip, and imperatively
 *     before mode switches (call flush() before unmounting to avoid losing the
 *     last <150ms of edits; the unmount cleanup only cancels the pending timer).
 *   • Pending debounce is cancelled before applying an external setContent.
 *
 * Keyboard shortcuts (non-StarterKit)
 * ────────────────────────────────────
 *   Mod-k       — open LinkPopover (insert / edit link)
 *   Mod-Shift-k — unlink (extendMarkRange + unsetLink)
 *   Table shortcuts (only when cursor is inside a table):
 *     Mod-Enter           — addRowAfter
 *     Mod-Shift-Enter     — addRowBefore
 *     Mod-Alt-ArrowRight  — addColumnAfter
 *     Mod-Alt-ArrowLeft   — addColumnBefore
 *     Mod-Alt-Backspace   — deleteRow
 *
 * Markdown input rule
 * ───────────────────
 *   Typing `[text](url)` followed by a space (or Enter at end of line)
 *   converts the bracket-paren syntax into a real link mark.
 *   Negative cases: `[ ]`, `[x]`, `[foo]` without `(url)` are NOT converted.
 *
 * Dark mode: tracked via MutationObserver on document.documentElement.classList,
 * same pattern as CodeEditor.tsx / MarkdownRenderer.tsx.
 *
 * Colours: semantic Tailwind tokens only — never raw hex.
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Link } from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import type { MarkdownStorage } from 'tiptap-markdown'
import Suggestion from '@tiptap/suggestion'
import type {
  SuggestionOptions,
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion'
import { Extension, InputRule } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import {
  RowsIcon,
  TableIcon,
  Columns3Icon,
  Trash2Icon,
  PencilIcon,
  MinusIcon,
  PlusIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from '@/components/ui/popover'
import { normalizeUrl } from './wysiwyg-utils'

// ---------------------------------------------------------------------------
// Slash-menu command definitions
// ---------------------------------------------------------------------------

interface SlashCommand {
  title: string
  description: string
  keywords: string[]
  icon: string
  action: (editor: Editor, openLinkPopover: () => void, openImagePopover: () => void) => void
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    title: 'Heading 1',
    description: 'Large section heading',
    keywords: ['h1', 'heading', 'title', '#'],
    icon: 'H1',
    action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2', 'heading', 'subtitle', '##'],
    icon: 'H2',
    action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    keywords: ['h3', 'heading', '###'],
    icon: 'H3',
    action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: 'Heading 4',
    description: 'Heading level 4',
    keywords: ['h4', 'heading'],
    icon: 'H4',
    action: (e) => e.chain().focus().toggleHeading({ level: 4 }).run(),
  },
  {
    title: 'Heading 5',
    description: 'Heading level 5',
    keywords: ['h5', 'heading'],
    icon: 'H5',
    action: (e) => e.chain().focus().toggleHeading({ level: 5 }).run(),
  },
  {
    title: 'Heading 6',
    description: 'Heading level 6',
    keywords: ['h6', 'heading'],
    icon: 'H6',
    action: (e) => e.chain().focus().toggleHeading({ level: 6 }).run(),
  },
  {
    title: 'Bullet List',
    description: 'Unordered list',
    keywords: ['ul', 'bullet', 'list', 'unordered', '-', '*'],
    icon: '•',
    action: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    title: 'Numbered List',
    description: 'Ordered list',
    keywords: ['ol', 'numbered', 'ordered', 'list', '1.'],
    icon: '1.',
    action: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    title: 'Task List',
    description: 'Checkbox / todo list',
    keywords: ['task', 'todo', 'checkbox', 'check', '[ ]'],
    icon: '☑',
    action: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    title: 'Blockquote',
    description: 'Indented block quote',
    keywords: ['quote', 'blockquote', '>'],
    icon: '❝',
    action: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    title: 'Code Block',
    description: 'Fenced code block',
    keywords: ['code', 'codeblock', 'fence', '```', 'pre'],
    icon: '</>',
    action: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: 'Table',
    description: 'Insert a 3×3 table',
    keywords: ['table', 'grid', '|'],
    icon: '⊞',
    action: (e) =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: 'Horizontal Rule',
    description: 'Divider / separator line',
    keywords: ['hr', 'rule', 'divider', '---', 'separator'],
    icon: '—',
    action: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    title: 'Bold',
    description: 'Bold text',
    keywords: ['bold', 'strong', '**'],
    icon: 'B',
    action: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    title: 'Italic',
    description: 'Italic text',
    keywords: ['italic', 'em', '*', '_'],
    icon: 'I',
    action: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    title: 'Strikethrough',
    description: 'Strikethrough text',
    keywords: ['strike', 'strikethrough', '~~', 's'],
    icon: 'S̶',
    action: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    title: 'Inline Code',
    description: 'Inline code span',
    keywords: ['code', 'inline', '`', 'monospace'],
    icon: '`',
    action: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    title: 'Link',
    description: 'Insert a hyperlink (Ctrl+K)',
    keywords: ['link', 'href', 'url', 'a', 'anchor'],
    icon: '🔗',
    action: (_e, openLinkPopover) => {
      openLinkPopover()
    },
  },
  {
    title: 'Image',
    description: 'Insert an image by URL',
    keywords: ['image', 'img', 'picture', 'photo', '![]'],
    icon: '🖼',
    action: (_e, _openLink, openImagePopover) => {
      openImagePopover()
    },
  },
]

// ---------------------------------------------------------------------------
// Slash menu portal
// ---------------------------------------------------------------------------

interface SlashMenuState {
  items: SlashCommand[]
  clientRect: () => DOMRect | null
  command: (item: SlashCommand) => void
  /** Increments each time items change so key-prop resets inner state */
  itemsVersion: number
}

interface SlashMenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

interface SlashMenuPortalProps extends SlashMenuState {
  handleRef: React.MutableRefObject<SlashMenuHandle | null>
  onClose: () => void
}

function SlashMenuInner({
  items,
  command,
  handleRef,
  onClose,
}: Omit<SlashMenuPortalProps, 'clientRect' | 'itemsVersion'>) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    handleRef.current = {
      onKeyDown({ event }: SuggestionKeyDownProps) {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((i) => (i + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          const item = items[selectedIndex]
          if (item) {
            command(item)
            onClose()
            return true
          }
        }
        return false
      },
    }
  })

  useEffect(() => {
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div ref={menuRef}>
      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
      ) : (
        items.map((item, idx) => (
          <button
            key={item.title}
            role="option"
            aria-selected={idx === selectedIndex}
            data-idx={idx}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
              idx === selectedIndex
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground hover:bg-accent/60',
            )}
            onClick={() => {
              command(item)
              onClose()
            }}
            onMouseEnter={() => setSelectedIndex(idx)}
          >
            <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-muted text-[10px] font-mono font-bold text-muted-foreground">
              {item.icon}
            </span>
            <span className="flex flex-col min-w-0">
              <span className="text-xs font-medium truncate">{item.title}</span>
              <span className="text-[10px] text-muted-foreground truncate leading-tight">
                {item.description}
              </span>
            </span>
          </button>
        ))
      )}
    </div>
  )
}

function SlashMenuPortal({
  items,
  clientRect,
  command,
  itemsVersion,
  handleRef,
  onClose,
}: SlashMenuPortalProps) {
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  useEffect(() => {
    function recompute() {
      const rect = clientRect()
      if (!rect) return
      const left = Math.max(8, rect.left + window.scrollX)
      const top = rect.bottom + window.scrollY + 6
      setPos({ top, left })
    }
    recompute()
    window.addEventListener('scroll', recompute, { capture: true })
    window.addEventListener('resize', recompute)
    return () => {
      window.removeEventListener('scroll', recompute, { capture: true })
      window.removeEventListener('resize', recompute)
    }
  }, [clientRect])

  const menu = (
    <div
      role="listbox"
      aria-label="Insert commands"
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        zIndex: 9999,
        minWidth: 260,
        maxWidth: 320,
        maxHeight: 320,
        overflowY: 'auto',
      }}
      className="wysiwyg-slash-menu"
    >
      <SlashMenuInner
        key={itemsVersion}
        items={items}
        command={command}
        handleRef={handleRef}
        onClose={onClose}
      />
    </div>
  )

  return createPortal(menu, document.body)
}

// ---------------------------------------------------------------------------
// Slash-command Suggestion extension
// ---------------------------------------------------------------------------

function buildSlashExtension(
  setMenuRef: React.MutableRefObject<((s: SlashMenuState | null) => void) | null>,
  handleRef: React.MutableRefObject<SlashMenuHandle | null>,
  openLinkRef: React.MutableRefObject<(() => void) | null>,
  openImageRef: React.MutableRefObject<(() => void) | null>,
): Extension {
  let itemsVersion = 0

  return Extension.create({
    name: 'slashCommand',
    addOptions() {
      return {
        suggestion: {
          char: '/',
          startOfLine: false,
          allowedPrefixes: null,
          command({
            editor,
            range,
            props,
          }: {
            editor: Editor
            range: { from: number; to: number }
            props: SlashCommand
          }) {
            editor.chain().focus().deleteRange(range).run()
            props.action(editor, () => {
              openLinkRef.current?.()
            }, () => {
              openImageRef.current?.()
            })
          },
          items({ query }: { query: string }): SlashCommand[] {
            const q = query.toLowerCase()
            if (!q) return SLASH_COMMANDS
            return SLASH_COMMANDS.filter(
              (c) =>
                c.title.toLowerCase().includes(q) ||
                c.keywords.some((k) => k.includes(q)),
            )
          },
          render() {
            return {
              onStart(props: SuggestionProps<SlashCommand>) {
                itemsVersion++
                setMenuRef.current?.({
                  items: props.items,
                  itemsVersion,
                  clientRect: () => props.clientRect?.() ?? null,
                  command: (item: SlashCommand) => props.command(item),
                })
              },
              onUpdate(props: SuggestionProps<SlashCommand>) {
                itemsVersion++
                setMenuRef.current?.({
                  items: props.items,
                  itemsVersion,
                  clientRect: () => props.clientRect?.() ?? null,
                  command: (item: SlashCommand) => props.command(item),
                })
              },
              onKeyDown(props: SuggestionKeyDownProps) {
                if (props.event.key === 'Escape') {
                  setMenuRef.current?.(null)
                  return true
                }
                return handleRef.current?.onKeyDown(props) ?? false
              },
              onExit() {
                setMenuRef.current?.(null)
              },
            }
          },
        } satisfies Partial<SuggestionOptions<SlashCommand>>,
      }
    },
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ]
    },
  })
}

// ---------------------------------------------------------------------------
// Link keyboard extension (Mod-k / Mod-Shift-k) + input rule [text](url)
// ---------------------------------------------------------------------------

/**
 * Matches `[text](url)` followed by a space or at end-of-line.
 * Capture groups:
 *   [1] text between [ ]
 *   [2] url between ( )
 *
 * Negative cases handled:
 *   - `[ ]` (task list unchecked) — empty text after trim
 *   - `[x]` or `[X]` (task list checked) — single letter, rejected by handler
 *   - `[foo]` without `(url)` — regex won't match
 *   - `[text]()` — empty url, regex requires 1+ chars in url group
 *
 * Note: single char link text like `[x](https://x.com)` is also blocked by
 * the handler guard as an intentional task-list disambiguation tradeoff.
 * The trailing space triggers via `addInputRules` (TipTap processes on space/Enter).
 */
export const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)\s?$/

/**
 * Builds the link keyboard extension: Mod-k opens the link popover,
 * Mod-Shift-k removes the link mark, table keyboard shortcuts.
 *
 * Table shortcuts only fire when the caret is inside a table; otherwise
 * they return false so the key falls through to other handlers.
 */
function buildLinkKeyboardExtension(
  openLinkRef: React.MutableRefObject<(() => void) | null>,
): Extension {
  return Extension.create({
    name: 'linkKeyboard',
    addKeyboardShortcuts() {
      return {
        // Open link popover
        'Mod-k': () => {
          openLinkRef.current?.()
          return true
        },
        // Remove link mark
        'Mod-Shift-k': ({ editor }) => {
          if (!editor.isActive('link')) return false
          editor.chain().focus().extendMarkRange('link').unsetLink().run()
          return true
        },
        // Table shortcuts — only when inside a table
        'Mod-Enter': ({ editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addRowAfter().run()
          return true
        },
        'Mod-Shift-Enter': ({ editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addRowBefore().run()
          return true
        },
        'Mod-Alt-ArrowRight': ({ editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addColumnAfter().run()
          return true
        },
        'Mod-Alt-ArrowLeft': ({ editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().addColumnBefore().run()
          return true
        },
        'Mod-Alt-Backspace': ({ editor }) => {
          if (!editor.isActive('table')) return false
          editor.chain().focus().deleteRow().run()
          return true
        },
      }
    },
    addInputRules() {
      const linkType = this.editor.schema.marks.link
      if (!linkType) return []

      return [
        new InputRule({
          find: MARKDOWN_LINK_REGEX,
          handler({ state, range, match }) {
            const text = match[1]
            const rawUrl = match[2]
            if (!text || !rawUrl) return null

            // Reject single char task-list matches: [ ] or [x]
            if (text.trim().length <= 1 && /^[\s xX]$/.test(text)) return null

            const href = normalizeUrl(rawUrl)
            if (!href) return null

            const { tr } = state
            // Replace the full match (including trailing space) with linked text
            const fullMatch = match[0]
            const hasTrailingSpace = fullMatch.endsWith(' ')
            const linkText = text
            const from = range.from
            const to = range.to

            tr.delete(from, to)
            const linkMark = linkType.create({ href })
            const textNode = state.schema.text(linkText, [linkMark])
            tr.insert(from, textNode)
            // Remove the link mark from cursor so subsequent typing is plain
            tr.removeStoredMark(linkType)
            // Add the trailing space back (outside the link)
            if (hasTrailingSpace) {
              tr.insertText(' ', from + linkText.length)
            }
          },
        }),
      ]
    },
  })
}

// ---------------------------------------------------------------------------
// Selection-rect helper — used to anchor popovers to the current selection
// ---------------------------------------------------------------------------

interface SelectionRect {
  top: number
  left: number
  width: number
  height: number
}

function getSelectionRect(editor: Editor): SelectionRect | null {
  const { state, view } = editor
  const { selection } = state

  try {
    if (editor.isActive('image')) {
      const nodeDom = view.nodeDOM(selection.from)
      if (nodeDom instanceof Element) {
        const r = nodeDom.getBoundingClientRect()
        return { top: r.top, left: r.left, width: r.width, height: r.height }
      }
    }

    const fromCoords = view.coordsAtPos(selection.from)
    const toCoords   = view.coordsAtPos(Math.max(selection.from, selection.to))
    const top    = Math.min(fromCoords.top,    toCoords.top)
    const left   = Math.min(fromCoords.left,   toCoords.left)
    const bottom = Math.max(fromCoords.bottom, toCoords.bottom)
    const right  = Math.max(fromCoords.right,  toCoords.right)
    return {
      top,
      left,
      width:  Math.max(right - left, 1),
      height: Math.max(bottom - top, 1),
    }
  } catch {
    return null
  }
}

function anchorRectToStyle(rect: SelectionRect | null): CSSProperties {
  if (rect) {
    return {
      position: 'fixed',
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      pointerEvents: 'none',
      visibility: 'hidden',
    }
  }
  return { position: 'fixed', top: 0, left: 0, width: 1, height: 1, pointerEvents: 'none', visibility: 'hidden' }
}

// ---------------------------------------------------------------------------
// LinkPopover — modal-free inline form for inserting/editing links
// ---------------------------------------------------------------------------

interface LinkPopoverState {
  open: boolean
  initialText: string
  initialHref: string
  isEditing: boolean
  anchorRect: SelectionRect | null
}

interface LinkPopoverProps {
  state: LinkPopoverState
  onSave: (text: string, href: string) => void
  onRemove: () => void
  onClose: () => void
}

interface LinkFormProps {
  initialText: string
  initialHref: string
  isEditing: boolean
  onSave: (text: string, href: string) => void
  onRemove: () => void
  onClose: () => void
}

function LinkForm({
  initialText,
  initialHref,
  isEditing,
  onSave,
  onRemove,
  onClose,
}: LinkFormProps) {
  const [text, setText] = useState(initialText)
  const [href, setHref] = useState(initialHref)
  const hrefInputRef = useRef<HTMLInputElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => {
      if (initialText) {
        hrefInputRef.current?.focus()
        hrefInputRef.current?.select()
      } else {
        textInputRef.current?.focus()
      }
    }, 50)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSave() {
    const normalised = normalizeUrl(href)
    onSave(text.trim(), normalised)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-foreground">
        {isEditing ? 'Edit link' : 'Insert link'}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wysiwyg-link-text" className="text-xs">
          Text
        </Label>
        <Input
          id="wysiwyg-link-text"
          ref={textInputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Link text"
          className="h-8 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wysiwyg-link-url" className="text-xs">
          URL
        </Label>
        <Input
          id="wysiwyg-link-url"
          ref={hrefInputRef}
          value={href}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://example.com"
          className="h-8 text-sm"
          type="url"
          autoComplete="off"
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSave}>
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onClose}
        >
          Cancel
        </Button>
        {isEditing && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onRemove}
            title="Remove link"
            aria-label="Remove link"
          >
            Unlink
          </Button>
        )}
      </div>
    </div>
  )
}

function LinkPopover({ state, onSave, onRemove, onClose }: LinkPopoverProps) {
  const formKey = `${state.open}|${state.initialText}|${state.initialHref}`

  return (
    <Popover open={state.open} onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor asChild>
        <span style={anchorRectToStyle(state.anchorRect)} />
      </PopoverAnchor>
      <PopoverContent
        className="w-80 p-4"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={onClose}
      >
        <LinkForm
          key={formKey}
          initialText={state.initialText}
          initialHref={state.initialHref}
          isEditing={state.isEditing}
          onSave={onSave}
          onRemove={onRemove}
          onClose={onClose}
        />
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// ImagePopover — modal-free inline form for inserting/editing images
// ---------------------------------------------------------------------------

interface ImagePopoverState {
  open: boolean
  initialSrc: string
  initialAlt: string
  isEditing: boolean
  anchorRect: SelectionRect | null
}

interface ImagePopoverProps {
  state: ImagePopoverState
  onSave: (src: string, alt: string) => void
  onRemove: () => void
  onClose: () => void
}

interface ImageFormProps {
  initialSrc: string
  initialAlt: string
  isEditing: boolean
  onSave: (src: string, alt: string) => void
  onRemove: () => void
  onClose: () => void
}

function ImageForm({
  initialSrc,
  initialAlt,
  isEditing,
  onSave,
  onRemove,
  onClose,
}: ImageFormProps) {
  const [src, setSrc] = useState(initialSrc)
  const [alt, setAlt] = useState(initialAlt)
  const srcInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => {
      srcInputRef.current?.focus()
      srcInputRef.current?.select()
    }, 50)
  }, [])

  function handleSave() {
    onSave(src.trim(), alt.trim())
    // Focus back to editor is handled by the caller (handleImageSave)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-foreground">
        {isEditing ? 'Edit image' : 'Insert image'}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wysiwyg-image-src" className="text-xs">
          Image URL
        </Label>
        <Input
          id="wysiwyg-image-src"
          ref={srcInputRef}
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://example.com/image.png"
          className="h-8 text-sm"
          autoComplete="off"
        />
        <p className="text-[10px] text-muted-foreground leading-tight">
          URL or base64 data: URI
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wysiwyg-image-alt" className="text-xs">
          Alt text
        </Label>
        <Input
          id="wysiwyg-image-alt"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the image"
          className="h-8 text-sm"
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSave}>
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onClose}
        >
          Cancel
        </Button>
        {isEditing && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onRemove}
            title="Remove image"
            aria-label="Remove image"
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}

function ImagePopover({ state, onSave, onRemove, onClose }: ImagePopoverProps) {
  const formKey = `${state.open}|${state.initialSrc}|${state.initialAlt}`

  return (
    <Popover open={state.open} onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor asChild>
        <span style={anchorRectToStyle(state.anchorRect)} />
      </PopoverAnchor>
      <PopoverContent
        className="w-80 p-4"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={onClose}
      >
        <ImageForm
          key={formKey}
          initialSrc={state.initialSrc}
          initialAlt={state.initialAlt}
          isEditing={state.isEditing}
          onSave={onSave}
          onRemove={onRemove}
          onClose={onClose}
        />
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// WysiwygEditor public API
// ---------------------------------------------------------------------------

export interface WysiwygEditorHandle {
  /** Flush any pending debounced onChange immediately (synchronously). */
  flush(): void
}

export interface WysiwygEditorProps {
  /** Markdown string — single source of truth */
  value: string
  /** Called with new markdown after edits (debounced by onChangeDebounceMs). */
  onChange?: (md: string) => void
  placeholder?: string
  readOnly?: boolean
  className?: string
  /**
   * When true: no slash menu; pure keyboard surface for inline embedding
   * (e.g. LLM prompt input). Markdown input rules, Ctrl+K link, and
   * image/table bubble menus still work in minimal mode.
   */
  minimal?: boolean
  /**
   * Debounce delay for onChange in ms. Default 150. Pass 0 for synchronous
   * emission (same as original behaviour).
   */
  onChangeDebounceMs?: number
}

// ---------------------------------------------------------------------------
// WysiwygEditor
// ---------------------------------------------------------------------------

const WysiwygEditor = forwardRef<WysiwygEditorHandle, WysiwygEditorProps>(
  function WysiwygEditor(
    {
      value,
      onChange,
      placeholder = 'Start writing… (type / for commands)',
      readOnly = false,
      className,
      minimal = false,
      onChangeDebounceMs = 150,
    }: WysiwygEditorProps,
    ref,
  ) {
    // ── Dark mode tracking ─────────────────────────────────────────────────
    const [dark, setDark] = useState(() =>
      document.documentElement.classList.contains('dark'),
    )
    useEffect(() => {
      const el = document.documentElement
      const obs = new MutationObserver(() => setDark(el.classList.contains('dark')))
      obs.observe(el, { attributes: true, attributeFilter: ['class'] })
      return () => obs.disconnect()
    }, [])

    // ── Slash menu state + refs ────────────────────────────────────────────
    const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null)
    const setMenuRef = useRef<((s: SlashMenuState | null) => void) | null>(null)
    const slashHandleRef = useRef<SlashMenuHandle | null>(null)

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useLayoutEffect(() => {
      setMenuRef.current = setSlashMenu
    })

    // ── Link popover state ─────────────────────────────────────────────────
    const [linkPopover, setLinkPopover] = useState<LinkPopoverState>({
      open: false,
      initialText: '',
      initialHref: '',
      isEditing: false,
      anchorRect: null,
    })

    const openLinkRef = useRef<(() => void) | null>(null)

    // ── Image popover state ────────────────────────────────────────────────
    const [imagePopover, setImagePopover] = useState<ImagePopoverState>({
      open: false,
      initialSrc: '',
      initialAlt: '',
      isEditing: false,
      anchorRect: null,
    })

    const openImageRef = useRef<(() => void) | null>(null)

    // ── Stable extensions ──────────────────────────────────────────────────
    // eslint-disable-next-line react-hooks/refs
    const [slashExtension] = useState(() =>
      buildSlashExtension(setMenuRef, slashHandleRef, openLinkRef, openImageRef),
    )

    // eslint-disable-next-line react-hooks/refs
    const [linkKeyboardExtension] = useState(() =>
      buildLinkKeyboardExtension(openLinkRef),
    )

    const extensions = useMemo(
      () => [
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
          openOnClick: readOnly,
          HTMLAttributes: {
            class: 'wysiwyg-link',
            rel: 'noopener noreferrer',
            target: '_blank',
          },
        }),
        Image.configure({
          HTMLAttributes: { class: 'wysiwyg-image max-w-full rounded' },
        }),
        Placeholder.configure({ placeholder }),
        Markdown.configure({
          html: false,
          tightLists: true,
          linkify: false,
          breaks: false,
          transformPastedText: true,
          transformCopiedText: false,
        }),
        linkKeyboardExtension,
        ...(minimal ? [] : [slashExtension]),
      ],
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [minimal],
    )

    // ── Debounce refs ──────────────────────────────────────────────────────
    /**
     * The last markdown string we emitted via onChange. Used to skip the
     * expensive getMarkdown() call in the sync-effect when the value prop
     * is just our own edit bouncing back through the parent's state.
     */
    const lastEmittedMd = useRef<string>(value)
    /** Timer id for the pending debounced emit. */
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /** Stable ref to the latest onChange prop (avoids re-creating the editor). */
    const onChangeRef = useRef(onChange)
    useLayoutEffect(() => { onChangeRef.current = onChange })
    /** Stable ref to the latest onChangeDebounceMs prop. */
    const debounceMsRef = useRef(onChangeDebounceMs)
    useLayoutEffect(() => { debounceMsRef.current = onChangeDebounceMs })

    // Helper: get markdown from editor storage.
    // Returns null when the editor is destroyed or the tiptap-markdown storage
    // is missing. TipTap v3 Editor.destroy() resets extensionStorage to {}, and
    // useEditor() destroys/recreates instances (StrictMode double-mount, deps
    // change), so closures captured on an old instance (debounce timer, blur
    // handler, flush ref) can observe a destroyed editor. Reading
    // storage.markdown.getMarkdown() there throws "Cannot read properties of
    // undefined (reading 'getMarkdown')" — never call into it unguarded.
    function getMarkdown(e: Editor | null | undefined): string | null {
      if (!e || e.isDestroyed) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (e.storage as Record<string, any>).markdown as MarkdownStorage | undefined
      if (!md || typeof md.getMarkdown !== 'function') return null
      return md.getMarkdown()
    }

    /**
     * Flush: run getMarkdown() + call onChange immediately.
     * Cancels any pending debounce timer first.
     */
    const flushRef = useRef<(() => void) | null>(null)

    // ── Editor instance ────────────────────────────────────────────────────
    const editor = useEditor({
      extensions,
      content: value,
      editable: !readOnly,
      onUpdate({ editor: e }) {
        // Cancel any pending debounce and schedule a new one.
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }

        const delayMs = debounceMsRef.current
        if (delayMs <= 0) {
          // Synchronous path (delayMs=0)
          const md = getMarkdown(e)
          if (md === null) return
          lastEmittedMd.current = md
          onChangeRef.current?.(md)
        } else {
          debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null
            const md = getMarkdown(e)
            if (md === null) return
            lastEmittedMd.current = md
            onChangeRef.current?.(md)
          }, delayMs)
        }
      },
      editorProps: {
        attributes: {
          class: cn(
            'wysiwyg-prose focus:outline-none',
            'min-h-[120px] w-full px-4 py-3',
          ),
        },
      },
    })

    // ── Populate flush ref once editor is available ────────────────────────
    useLayoutEffect(() => {
      flushRef.current = () => {
        if (!editor || editor.isDestroyed) return
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }
        const md = getMarkdown(editor)
        if (md === null) return
        lastEmittedMd.current = md
        onChangeRef.current?.(md)
      }
    })

    // ── Expose flush via forwardRef ────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      flush() {
        flushRef.current?.()
      },
    }), [])

    // ── Flush on blur ──────────────────────────────────────────────────────
    useEffect(() => {
      if (!editor) return
      const handleBlur = () => flushRef.current?.()
      editor.on('blur', handleBlur)
      return () => { editor.off('blur', handleBlur) }
    }, [editor])

    // ── Flush on unmount ───────────────────────────────────────────────────
    useEffect(() => {
      return () => {
        // Run flush on unmount using current refs
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }
        // We can't call getMarkdown here because editor may already be
        // destroyed in the same cleanup cycle; the parent should call
        // flush() before unmounting for reliable results.
      }
    }, [])

    // ── Flush when readOnly flips ──────────────────────────────────────────
    const prevReadOnly = useRef(readOnly)
    useEffect(() => {
      if (prevReadOnly.current !== readOnly) {
        prevReadOnly.current = readOnly
        flushRef.current?.()
      }
      editor?.setEditable(!readOnly)
    }, [editor, readOnly])

    // ── Populate popover opener refs ───────────────────────────────────────
    useLayoutEffect(() => {
      openLinkRef.current = () => {
        if (!editor) return
        const { selection } = editor.state
        const selectedText = editor.state.doc.textBetween(
          selection.from,
          selection.to,
          '',
        )
        const linkAttrs = editor.getAttributes('link') as { href?: string }
        const isEditing = editor.isActive('link')

        let prefillText = selectedText
        if (!prefillText && isEditing) {
          const { $from } = selection
          const linkMark = $from.marks().find((m) => m.type.name === 'link')
          if (linkMark) {
            let from = selection.from
            let to = selection.from
            while (from > 0 && editor.state.doc.rangeHasMark(from - 1, from, linkMark.type)) {
              from--
            }
            while (to < editor.state.doc.content.size && editor.state.doc.rangeHasMark(to, to + 1, linkMark.type)) {
              to++
            }
            prefillText = editor.state.doc.textBetween(from, to, '')
          }
        }

        const anchorRect = getSelectionRect(editor)
        setLinkPopover({
          open: true,
          initialText: prefillText,
          initialHref: linkAttrs.href ?? '',
          isEditing,
          anchorRect,
        })
      }

      openImageRef.current = () => {
        if (!editor) return
        const imageAttrs = editor.getAttributes('image') as { src?: string; alt?: string }
        const anchorRect = getSelectionRect(editor)
        setImagePopover({
          open: true,
          initialSrc: imageAttrs.src ?? '',
          initialAlt: imageAttrs.alt ?? '',
          isEditing: editor.isActive('image'),
          anchorRect,
        })
      }
    })

    // ── Sync external value → editor (e.g. doc switch) ────────────────────
    useEffect(() => {
      if (!editor || editor.isDestroyed) return
      // If value equals what we last emitted, this is our own round-trip — skip.
      if (value === lastEmittedMd.current) return
      // Cancel any pending debounce before forcing a setContent.
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      // External change (doc switch, edit in Markdown mode) — apply it.
      editor.commands.setContent(value, { emitUpdate: false })
      lastEmittedMd.current = value
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    // ── Close slash menu ───────────────────────────────────────────────────
    const handleClose = useCallback(() => setSlashMenu(null), [])

    // ── Link popover handlers ──────────────────────────────────────────────

    const handleLinkSave = useCallback(
      (text: string, href: string) => {
        if (!editor) return
        setLinkPopover((s) => ({ ...s, open: false }))
        if (!href) {
          editor.chain().focus().extendMarkRange('link').unsetLink().run()
          return
        }
        if (text) {
          const { selection } = editor.state
          const hasSelection = selection.from !== selection.to

          if (hasSelection) {
            editor
              .chain()
              .focus()
              .deleteSelection()
              .insertContent({
                type: 'text',
                text,
                marks: [{ type: 'link', attrs: { href } }],
              })
              .run()
          } else if (editor.isActive('link')) {
            editor
              .chain()
              .focus()
              .extendMarkRange('link')
              .deleteSelection()
              .insertContent({
                type: 'text',
                text,
                marks: [{ type: 'link', attrs: { href } }],
              })
              .run()
          } else {
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'text',
                text,
                marks: [{ type: 'link', attrs: { href } }],
              })
              .run()
          }
        } else {
          editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
        }
        // Return focus to editor after save
        editor.commands.focus()
      },
      [editor],
    )

    const handleLinkRemove = useCallback(() => {
      setLinkPopover((s) => ({ ...s, open: false }))
      editor?.chain().focus().extendMarkRange('link').unsetLink().run()
    }, [editor])

    const handleLinkClose = useCallback(() => {
      setLinkPopover((s) => ({ ...s, open: false }))
      editor?.commands.focus()
    }, [editor])

    // ── Image popover handlers ─────────────────────────────────────────────

    const handleImageSave = useCallback(
      (src: string, alt: string) => {
        if (!editor) return
        setImagePopover((s) => ({ ...s, open: false }))
        if (!src) {
          editor.commands.focus()
          return
        }
        if (editor.isActive('image')) {
          editor.chain().focus().updateAttributes('image', { src, alt }).run()
        } else {
          editor.chain().focus().setImage({ src, alt }).run()
        }
        // Return focus to editor after save
        editor.commands.focus()
      },
      [editor],
    )

    const handleImageRemove = useCallback(() => {
      setImagePopover((s) => ({ ...s, open: false }))
      if (!editor) return
      editor.chain().focus().deleteSelection().run()
    }, [editor])

    const handleImageClose = useCallback(() => {
      setImagePopover((s) => ({ ...s, open: false }))
      editor?.commands.focus()
    }, [editor])

    // ── Render ─────────────────────────────────────────────────────────────
    return (
      <div className={cn('wysiwyg-root relative', dark && 'dark', className)}>
        <EditorContent editor={editor} />

        {/* ── Image bubble toolbar ───────────────────────────────────────────
            Shows when an image node is selected.
            Link bubble removed — links are keyboard-first (Ctrl+K).
        */}
        {editor && !readOnly && (
          <BubbleMenu
            editor={editor}
            pluginKey="imageBubble"
            options={{ placement: 'bottom' }}
            shouldShow={({ editor: e }) => e.isActive('image')}
          >
            <div className="wysiwyg-bubble-toolbar">
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                title="Edit image"
                aria-label="Edit image"
                onClick={() => {
                  openImageRef.current?.()
                }}
              >
                <PencilIcon className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Remove image"
                aria-label="Remove image"
                onClick={() => {
                  editor.chain().focus().deleteSelection().run()
                }}
              >
                <Trash2Icon className="h-3 w-3" />
              </Button>
            </div>
          </BubbleMenu>
        )}

        {/* ── Table bubble toolbar ──────────────────────────────────────────
            Shows when the caret is inside a table node and no image is selected.
        */}
        {editor && !readOnly && (
          <BubbleMenu
            editor={editor}
            pluginKey="tableBubble"
            options={{ placement: 'top' }}
            shouldShow={({ editor: e }) =>
              e.isActive('table') && !e.isActive('image')
            }
          >
            <div className="wysiwyg-bubble-toolbar flex-wrap gap-y-1">
              {/* Row operations */}
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                title="Add row above (Ctrl+Shift+Enter)"
                aria-label="Add row above"
                onClick={() => editor.chain().focus().addRowBefore().run()}
              >
                <span className="flex flex-col items-center gap-0 leading-none">
                  <PlusIcon className="h-2 w-2" />
                  <RowsIcon className="h-2.5 w-2.5" />
                </span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                title="Add row below (Ctrl+Enter)"
                aria-label="Add row below"
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                <span className="flex flex-col items-center gap-0 leading-none">
                  <RowsIcon className="h-2.5 w-2.5" />
                  <PlusIcon className="h-2 w-2" />
                </span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Delete row (Ctrl+Alt+Backspace)"
                aria-label="Delete row"
                onClick={() => editor.chain().focus().deleteRow().run()}
              >
                <span className="flex flex-col items-center gap-0 leading-none">
                  <RowsIcon className="h-2.5 w-2.5" />
                  <MinusIcon className="h-2 w-2" />
                </span>
              </Button>

              <div className="wysiwyg-bubble-sep" />

              {/* Column operations */}
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                title="Add column before (Ctrl+Alt+←)"
                aria-label="Add column before"
                onClick={() => editor.chain().focus().addColumnBefore().run()}
              >
                <span className="flex flex-row items-center gap-0 leading-none">
                  <PlusIcon className="h-2 w-2" />
                  <Columns3Icon className="h-2.5 w-2.5" />
                </span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                title="Add column after (Ctrl+Alt+→)"
                aria-label="Add column after"
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                <span className="flex flex-row items-center gap-0 leading-none">
                  <Columns3Icon className="h-2.5 w-2.5" />
                  <PlusIcon className="h-2 w-2" />
                </span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Delete column"
                aria-label="Delete column"
                onClick={() => editor.chain().focus().deleteColumn().run()}
              >
                <span className="flex flex-row items-center gap-0 leading-none">
                  <Columns3Icon className="h-2.5 w-2.5" />
                  <MinusIcon className="h-2 w-2" />
                </span>
              </Button>

              <div className="wysiwyg-bubble-sep" />

              {/* Delete whole table */}
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Delete table"
                aria-label="Delete table"
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                <span className="flex flex-row items-center gap-0 leading-none">
                  <TableIcon className="h-2.5 w-2.5" />
                  <MinusIcon className="h-2 w-2" />
                </span>
              </Button>
            </div>
          </BubbleMenu>
        )}

        {/* ── Slash menu portal ─────────────────────────────────────────────── */}
        {!minimal && slashMenu && (
          <SlashMenuPortal
            items={slashMenu.items}
            clientRect={slashMenu.clientRect}
            command={slashMenu.command}
            itemsVersion={slashMenu.itemsVersion}
            handleRef={slashHandleRef}
            onClose={handleClose}
          />
        )}

        {/* ── Link popover form ─────────────────────────────────────────────── */}
        <LinkPopover
          state={linkPopover}
          onSave={handleLinkSave}
          onRemove={handleLinkRemove}
          onClose={handleLinkClose}
        />

        {/* ── Image popover form ────────────────────────────────────────────── */}
        <ImagePopover
          state={imagePopover}
          onSave={handleImageSave}
          onRemove={handleImageRemove}
          onClose={handleImageClose}
        />
      </div>
    )
  },
)

export default WysiwygEditor
