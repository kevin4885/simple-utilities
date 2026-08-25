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
 *   Three bubble menus are registered; only one can show at a time, gated by
 *   precise shouldShow callbacks so they never fight each other:
 *     1. LinkBubble  — when link mark is active (and image NOT selected)
 *     2. ImageBubble — when image node is selected
 *     3. TableBubble — when cursor is inside a table (and no link / image)
 *
 *   Popover forms (shadcn Popover + Input + Button + Label) are used for
 *   inserting/editing links and images. The BubbleMenus host small inline
 *   toolbars; edit actions open the corresponding popover programmatically.
 *
 * URL normalisation: normalizeUrl() (src/components/editor/wysiwyg-utils.ts)
 *   prepends https:// to bare domains; leaves mailto:, #anchors, data: URIs,
 *   relative paths, and URLs that already have a scheme untouched.
 *
 * Props
 * ─────
 *   value       — markdown string (single source of truth)
 *   onChange    — called with new markdown on every edit
 *   placeholder — placeholder text when empty
 *   readOnly    — disables editing
 *   className   — extra wrapper classes
 *   minimal     — when true: no slash menu; pure keyboard surface for inline
 *                 embedding (e.g. LLM prompt input). Input rules still apply.
 *                 Link/Image/Table bubble menus still work in minimal mode
 *                 (they are useful even in inline embedding).
 *
 * Dark mode: tracked via MutationObserver on document.documentElement.classList,
 * same pattern as CodeEditor.tsx / MarkdownRenderer.tsx.
 *
 * Colours: semantic Tailwind tokens only — never raw hex.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import {
  RowsIcon,
  TableIcon,
  Columns3Icon,
  Trash2Icon,
  ExternalLinkIcon,
  PencilIcon,
  UnlinkIcon,
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

// The slash command for link will call openLinkPopover (injected at runtime).
// The slash command for image will call openImagePopover (injected at runtime).
// This avoids window.prompt entirely.

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
    description: 'Insert a hyperlink',
    keywords: ['link', 'href', 'url', 'a', 'anchor'],
    icon: '🔗',
    // openLinkPopover is injected at runtime via the slash command dispatch
    action: (_e, openLinkPopover) => {
      openLinkPopover()
    },
  },
  {
    title: 'Image',
    description: 'Insert an image by URL',
    keywords: ['image', 'img', 'picture', 'photo', '![]'],
    icon: '🖼',
    // openImagePopover is injected at runtime via the slash command dispatch
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

  // Expose keyboard handler to the Suggestion plugin via ref
  // (runs after every render — always closes over current state + items)
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

  // Scroll selected item into view
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

  // Position the menu below the cursor
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
      {/* key=itemsVersion resets selectedIndex to 0 whenever items change */}
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
// Bridges the ProseMirror plugin lifecycle into React state via stable refs.
// ---------------------------------------------------------------------------

function buildSlashExtension(
  /** Stable ref to a setter for React slash-menu state */
  setMenuRef: React.MutableRefObject<((s: SlashMenuState | null) => void) | null>,
  /** Ref that SlashMenuInner will populate with its onKeyDown handler */
  handleRef: React.MutableRefObject<SlashMenuHandle | null>,
  /** Ref to the openLinkPopover callback (populated after component mounts) */
  openLinkRef: React.MutableRefObject<(() => void) | null>,
  /** Ref to the openImagePopover callback (populated after component mounts) */
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
            // Inject the popover openers into the action call
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
// LinkPopover — modal-free inline form for inserting/editing links
// ---------------------------------------------------------------------------

interface LinkPopoverState {
  open: boolean
  /** Initial text — empty for new, pre-filled from selection for wrap */
  initialText: string
  /** Initial href — empty for new, pre-filled for edit */
  initialHref: string
  /** True when editing an existing link (shows "Remove link" button) */
  isEditing: boolean
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

/** Inner controlled form — remounted via `key` when popover (re-)opens */
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

  // Focus on mount (no useEffect + setState needed; state is initialised above)
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
  // Key changes whenever the popover opens or its initial values change,
  // causing LinkForm to remount with fresh useState initializers — no effect needed.
  const formKey = `${state.open}|${state.initialText}|${state.initialHref}`

  return (
    <Popover open={state.open} onOpenChange={(open) => { if (!open) onClose() }}>
      {/* PopoverAnchor attaches to nothing — we position manually via PopoverContent's
          side="bottom" and the popover renders portalled to body anyway */}
      <PopoverAnchor asChild>
        <span style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }} />
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

/** Inner controlled form — remounted via `key` when popover (re-)opens */
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
  // Key changes whenever the popover opens or its initial values change,
  // causing ImageForm to remount with fresh useState initializers — no effect needed.
  const formKey = `${state.open}|${state.initialSrc}|${state.initialAlt}`

  return (
    <Popover open={state.open} onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor asChild>
        <span style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }} />
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
// WysiwygEditor
// ---------------------------------------------------------------------------

export interface WysiwygEditorProps {
  /** Markdown string — single source of truth */
  value: string
  /** Called with new markdown on every edit */
  onChange?: (md: string) => void
  placeholder?: string
  readOnly?: boolean
  className?: string
  /**
   * When true: no slash menu; pure keyboard surface for inline embedding
   * (e.g. LLM prompt input). Markdown input rules still apply.
   * Link/Image/Table bubble menus and popovers are still active in minimal
   * mode — they are useful even when embedding the editor inline.
   */
  minimal?: boolean
}

export default function WysiwygEditor({
  value,
  onChange,
  placeholder = 'Start writing… (type / for commands)',
  readOnly = false,
  className,
  minimal = false,
}: WysiwygEditorProps) {
  // ── Dark mode tracking (MutationObserver pattern) ─────────────────────────
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  )
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')))
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  // ── Slash menu state + refs ────────────────────────────────────────────────
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null)

  // Refs used by the ProseMirror plugin (created once outside render cycle)
  const setMenuRef = useRef<((s: SlashMenuState | null) => void) | null>(null)
  const slashHandleRef = useRef<SlashMenuHandle | null>(null)

  // Keep setter ref in sync via useLayoutEffect (runs synchronously after DOM
  // mutations, not during render — avoids the react-hooks/refs lint error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    setMenuRef.current = setSlashMenu
  })

  // ── Link popover state ─────────────────────────────────────────────────────
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState>({
    open: false,
    initialText: '',
    initialHref: '',
    isEditing: false,
  })

  // Ref for openLinkPopover so it can be called from the slash extension
  const openLinkRef = useRef<(() => void) | null>(null)

  // ── Image popover state ────────────────────────────────────────────────────
  const [imagePopover, setImagePopover] = useState<ImagePopoverState>({
    open: false,
    initialSrc: '',
    initialAlt: '',
    isEditing: false,
  })

  // Ref for openImagePopover so it can be called from the slash extension
  const openImageRef = useRef<(() => void) | null>(null)

  // ── Slash extension (stable — lazy-initialised with useState) ─────────────
  // useState's lazy initializer runs exactly once (on mount) and never during
  // a re-render. buildSlashExtension stores the ref objects for later access in
  // ProseMirror plugin callbacks (not during render) — disable is correct here.
  // eslint-disable-next-line react-hooks/refs
  const [slashExtension] = useState(() =>
    buildSlashExtension(setMenuRef, slashHandleRef, openLinkRef, openImageRef),
  )

  // ── Extensions ────────────────────────────────────────────────────────────
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // In Tiptap v3 the undo/redo extension is 'undoRedo', not 'history'
        undoRedo: { depth: 200 },
        codeBlock: { HTMLAttributes: { class: 'wysiwyg-code-block' } },
        // Disable StarterKit's bundled Link so we can configure it below
        // with our own HTMLAttributes (class, rel, target) and openOnClick.
        // StarterKit v3 bundles Link by default; omitting link:false causes
        // a duplicate-name warning and the configured options being dropped.
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
        // openOnClick opens existing links. In edit mode we disable this so
        // clicking a link triggers the bubble menu instead. In readOnly mode
        // links open normally.
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
      // tiptap-markdown: handles markdown↔doc serialisation.
      // transformPastedText allows pasting raw markdown into the WYSIWYG surface.
      Markdown.configure({
        html: false,
        tightLists: true,
        linkify: false,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: false,
      }),
      ...(minimal ? [] : [slashExtension]),
    ],
    // Intentionally stable — only rebuild when minimal changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minimal],
  )

  // ── Prevent external-sync loop ────────────────────────────────────────────
  const suppressExternalSync = useRef(false)

  // Helper: get markdown from editor storage (typed via MarkdownStorage)
  function getMarkdown(e: NonNullable<ReturnType<typeof useEditor>>): string {
    // editor.storage is Tiptap's Record<string, any>; cast to access tiptap-markdown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((e.storage as Record<string, any>).markdown as MarkdownStorage).getMarkdown()
  }

  // ── Editor instance ───────────────────────────────────────────────────────
  const editor = useEditor({
    extensions,
    content: value,
    editable: !readOnly,
    onUpdate({ editor: e }) {
      suppressExternalSync.current = true
      const md = getMarkdown(e)
      onChange?.(md)
      requestAnimationFrame(() => {
        suppressExternalSync.current = false
      })
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

  // ── Populate popover opener refs once editor is available ──────────────────
  // These are stable functions that read the current editor state; they only
  // need to be recreated when `editor` reference changes (post-mount).

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

      // When editing an existing link with no selection (caret inside),
      // pre-fill the text by expanding the range to the full link extent.
      let prefillText = selectedText
      if (!prefillText && isEditing) {
        // Use ProseMirror to resolve the mark range and extract text
        const { $from } = selection
        const linkMark = $from.marks().find((m) => m.type.name === 'link')
        if (linkMark) {
          let from = selection.from
          let to = selection.from
          // Walk backwards to find mark start
          while (from > 0 && editor.state.doc.rangeHasMark(from - 1, from, linkMark.type)) {
            from--
          }
          // Walk forwards to find mark end
          while (to < editor.state.doc.content.size && editor.state.doc.rangeHasMark(to, to + 1, linkMark.type)) {
            to++
          }
          prefillText = editor.state.doc.textBetween(from, to, '')
        }
      }

      setLinkPopover({
        open: true,
        initialText: prefillText,
        initialHref: linkAttrs.href ?? '',
        isEditing,
      })
    }

    openImageRef.current = () => {
      if (!editor) return
      const imageAttrs = editor.getAttributes('image') as { src?: string; alt?: string }
      setImagePopover({
        open: true,
        initialSrc: imageAttrs.src ?? '',
        initialAlt: imageAttrs.alt ?? '',
        isEditing: editor.isActive('image'),
      })
    }
  })

  // ── Sync external value → editor (e.g. doc switch) ────────────────────────
  useEffect(() => {
    if (!editor || suppressExternalSync.current) return
    const current = getMarkdown(editor)
    if (current !== value) {
      editor.commands.setContent(value, { emitUpdate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // ── Update editable state ─────────────────────────────────────────────────
  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  // ── Close slash menu ──────────────────────────────────────────────────────
  const handleClose = useCallback(() => setSlashMenu(null), [])

  // ── Link popover handlers ─────────────────────────────────────────────────

  const handleLinkSave = useCallback(
    (text: string, href: string) => {
      if (!editor) return
      setLinkPopover((s) => ({ ...s, open: false }))
      // Empty URL = remove link / nothing
      if (!href) {
        editor.chain().focus().unsetLink().run()
        return
      }
      if (text) {
        // Insert or replace selected text as a link
        const { selection } = editor.state
        const hasSelection = selection.from !== selection.to

        if (hasSelection) {
          // Wrap selection in link mark (text replaced by whatever user typed in the field)
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
          // Caret is inside existing link — update href (and optionally text)
          // First expand selection to cover the whole link, then replace
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
          // No selection, not inside a link — insert new linked text at cursor
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
        // No text — just apply link mark to existing selection / position
        editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
      }
    },
    [editor],
  )

  const handleLinkRemove = useCallback(() => {
    setLinkPopover((s) => ({ ...s, open: false }))
    editor?.chain().focus().extendMarkRange('link').unsetLink().run()
  }, [editor])

  const handleLinkClose = useCallback(() => {
    setLinkPopover((s) => ({ ...s, open: false }))
  }, [])

  // ── Image popover handlers ────────────────────────────────────────────────

  const handleImageSave = useCallback(
    (src: string, alt: string) => {
      if (!editor) return
      setImagePopover((s) => ({ ...s, open: false }))
      if (!src) return
      if (editor.isActive('image')) {
        // Update existing image node
        editor.chain().focus().updateAttributes('image', { src, alt }).run()
      } else {
        editor.chain().focus().setImage({ src, alt }).run()
      }
    },
    [editor],
  )

  const handleImageRemove = useCallback(() => {
    setImagePopover((s) => ({ ...s, open: false }))
    if (!editor) return
    // Delete the selected image node
    editor.chain().focus().deleteSelection().run()
  }, [editor])

  const handleImageClose = useCallback(() => {
    setImagePopover((s) => ({ ...s, open: false }))
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={cn('wysiwyg-root relative', dark && 'dark', className)}>
      <EditorContent editor={editor} />

      {/* ── Link bubble toolbar ────────────────────────────────────────────
          Shows when the caret is inside a link mark.
          shouldShow: link is active AND image is NOT selected (avoid collision).
          Implementation: BubbleMenu from @tiptap/react/menus — it uses
          @floating-ui/dom (already a transitive dep) for positioning.
      */}
      {editor && !readOnly && (
        <BubbleMenu
          editor={editor}
          pluginKey="linkBubble"
          options={{ placement: 'bottom' }}
          shouldShow={({ editor: e }) =>
            e.isActive('link') && !e.isActive('image')
          }
        >
          <div className="wysiwyg-bubble-toolbar">
            {/* Truncated URL display */}
            {(() => {
              const href = (editor.getAttributes('link') as { href?: string }).href ?? ''
              const display =
                href.length > 40 ? href.slice(0, 38) + '…' : href
              return (
                <span
                  className="text-[11px] text-muted-foreground max-w-[140px] truncate shrink"
                  title={href}
                >
                  {display}
                </span>
              )
            })()}
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0"
              title="Open link in new tab"
              aria-label="Open link in new tab"
              onClick={() => {
                const href = (editor.getAttributes('link') as { href?: string }).href
                if (href) window.open(href, '_blank', 'noopener,noreferrer')
              }}
            >
              <ExternalLinkIcon className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0"
              title="Edit link"
              aria-label="Edit link"
              onClick={() => {
                openLinkRef.current?.()
              }}
            >
              <PencilIcon className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              title="Remove link"
              aria-label="Remove link"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run()
              }}
            >
              <UnlinkIcon className="h-3 w-3" />
            </Button>
          </div>
        </BubbleMenu>
      )}

      {/* ── Image bubble toolbar ───────────────────────────────────────────
          Shows when an image node is selected.
          The link bubble already excludes images (shouldShow: !e.isActive('image')),
          so no additional gate is needed here.
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
          Shows when the caret is inside a table node.
          shouldShow: table is active AND link/image are NOT active
          (so table controls don't overlap link/image toolbars).
      */}
      {editor && !readOnly && (
        <BubbleMenu
          editor={editor}
          pluginKey="tableBubble"
          options={{ placement: 'top' }}
          shouldShow={({ editor: e }) =>
            e.isActive('table') && !e.isActive('link') && !e.isActive('image')
          }
        >
          <div className="wysiwyg-bubble-toolbar flex-wrap gap-y-1">
            {/* Row operations */}
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0"
              title="Add row above"
              aria-label="Add row above"
              onClick={() => editor.chain().focus().addRowBefore().run()}
            >
              {/* Row + up: use a stacked icon approach */}
              <span className="flex flex-col items-center gap-0 leading-none">
                <PlusIcon className="h-2 w-2" />
                <RowsIcon className="h-2.5 w-2.5" />
              </span>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0"
              title="Add row below"
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
              title="Delete row"
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
              title="Add column before"
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
              title="Add column after"
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
}
