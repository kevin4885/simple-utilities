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
 * Props
 * ─────
 *   value       — markdown string (single source of truth)
 *   onChange    — called with new markdown on every edit
 *   placeholder — placeholder text when empty
 *   readOnly    — disables editing
 *   className   — extra wrapper classes
 *   minimal     — when true: no slash menu; pure keyboard surface for inline
 *                 embedding (e.g. LLM prompt input). Input rules still apply.
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
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Slash-menu command definitions
// ---------------------------------------------------------------------------

interface SlashCommand {
  title: string
  description: string
  keywords: string[]
  icon: string
  action: (editor: Editor) => void
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
    description: 'Insert a hyperlink',
    keywords: ['link', 'href', 'url', 'a', 'anchor'],
    icon: '🔗',
    action: (e) => {
      const url = window.prompt('Enter URL:')
      if (url) e.chain().focus().setLink({ href: url }).run()
    },
  },
  {
    title: 'Image',
    description: 'Insert an image by URL',
    keywords: ['image', 'img', 'picture', 'photo', '![]'],
    icon: '🖼',
    action: (e) => {
      const url = window.prompt('Enter image URL:')
      if (url) e.chain().focus().setImage({ src: url }).run()
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
            props.action(editor)
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

  // ── Slash extension (stable — lazy-initialised with useState) ─────────────
  // useState's lazy initializer runs exactly once (on mount) and never during
  // a re-render. buildSlashExtension stores the ref objects for later access in
  // ProseMirror plugin callbacks (not during render) — disable is correct here.
  // eslint-disable-next-line react-hooks/refs
  const [slashExtension] = useState(() =>
    buildSlashExtension(setMenuRef, slashHandleRef),
  )

  // ── Extensions ────────────────────────────────────────────────────────────
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // In Tiptap v3 the undo/redo extension is 'undoRedo', not 'history'
        undoRedo: { depth: 200 },
        codeBlock: { HTMLAttributes: { class: 'wysiwyg-code-block' } },
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
        openOnClick: !readOnly,
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={cn('wysiwyg-root relative', dark && 'dark', className)}>
      <EditorContent editor={editor} />

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
    </div>
  )
}
