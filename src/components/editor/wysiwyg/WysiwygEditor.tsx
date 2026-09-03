/**
 * wysiwyg/WysiwygEditor.tsx — main WYSIWYG editor component
 *
 * A standalone, reusable React component. Single source of truth is a
 * markdown string (value prop); the editor parses it to a ProseMirror doc on
 * mount / external value change and serialises back to markdown on every edit.
 *
 * Markdown library: tiptap-markdown (0.9.x, targets Tiptap v3).
 *
 * Props
 * ─────
 *   value              — markdown string (single source of truth)
 *   onChange           — called with new markdown (debounced; see below)
 *   placeholder        — placeholder text when empty
 *   readOnly           — disables editing
 *   className          — extra wrapper classes
 *   minimal            — when true: no slash menu, no toolbar. Pure keyboard surface.
 *   toolbar            — false | true | ToolbarConfig (default: true)
 *                        true = default TOOLBAR_CONFIG; false = no toolbar;
 *                        ToolbarConfig = custom config. Ignored when minimal=true.
 *   onChangeDebounceMs — debounce delay for onChange (default 150; 0 = sync)
 *   ref (forwarded)    — exposes { flush(): void }
 *
 * Performance
 * ───────────
 *   • lastEmittedMd ref: skips getMarkdown() in the sync-effect when the
 *     value prop equals what was last emitted (our own edit round-trip).
 *   • Debounced emit: onChange is called after 150ms idle (not per keystroke).
 *   • Pending debounce is cancelled before applying an external setContent.
 *
 * New in Phase 1:
 *   • Toolbar (sticky above EditorContent) — data-driven from toolbar/config.ts
 *   • SelectionBubble — floating toolbar for non-empty text selections
 *   • TableBubble updated to mutual-exclude with SelectionBubble
 *   • TooltipProvider wraps the component (for toolbar tooltips)
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
} from 'react'
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
import type { Editor } from '@tiptap/core'
import { cn } from '@/lib/utils'
import { TooltipProvider } from '@/components/ui/tooltip'

// Submodules
import { buildSlashExtension, SlashMenuPortal } from './extensions/slashCommand'
import type { SlashMenuState, SlashMenuHandle } from './extensions/slashCommand'
import { buildLinkKeyboardExtension } from './extensions/linkKeyboard'
import { LinkPopover } from './forms/LinkForm'
import type { LinkPopoverState } from './forms/LinkForm'
import { ImagePopover } from './forms/ImageForm'
import type { ImagePopoverState } from './forms/ImageForm'
import { ImageBubble } from './menus/ImageBubble'
import { TableBubble } from './menus/TableBubble'
import { SelectionBubble } from './menus/SelectionBubble'
import { Toolbar } from './toolbar/Toolbar'
import { TOOLBAR_CONFIG } from './toolbar/config'
import type { ToolbarConfig } from './toolbar/config'
import { getSelectionRect } from './utils'

// ---------------------------------------------------------------------------
// Public API
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
   * When true: no slash menu, no toolbar. Pure keyboard surface for inline
   * embedding (e.g. LLM prompt input). Ctrl+K, input rules, image/table
   * bubbles still work in minimal mode.
   */
  minimal?: boolean
  /**
   * Controls the formatting toolbar above the editor.
   *   true (default) — render default TOOLBAR_CONFIG
   *   false          — no toolbar
   *   ToolbarConfig  — custom config array
   * Ignored when minimal=true.
   */
  toolbar?: boolean | ToolbarConfig
  /**
   * Debounce delay for onChange in ms. Default 150. Pass 0 for synchronous
   * emission.
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
      toolbar = true,
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
    const [slashExtension] = useState(() =>
      buildSlashExtension(setMenuRef, slashHandleRef, openLinkRef, openImageRef),
    )

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
    const lastEmittedMd = useRef<string>(value)
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const onChangeRef = useRef(onChange)
    useLayoutEffect(() => { onChangeRef.current = onChange })
    const debounceMsRef = useRef(onChangeDebounceMs)
    useLayoutEffect(() => { debounceMsRef.current = onChangeDebounceMs })

    function getMarkdown(e: Editor | null | undefined): string | null {
      if (!e || e.isDestroyed) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (e.storage as Record<string, any>).markdown as MarkdownStorage | undefined
      if (!md || typeof md.getMarkdown !== 'function') return null
      return md.getMarkdown()
    }

    const flushRef = useRef<(() => void) | null>(null)

    // ── Editor instance ────────────────────────────────────────────────────
    const editor = useEditor({
      extensions,
      content: value,
      editable: !readOnly,
      onUpdate({ editor: e }) {
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }

        const delayMs = debounceMsRef.current
        if (delayMs <= 0) {
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

    // ── Populate flush ref ─────────────────────────────────────────────────
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
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }
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

    // ── Sync external value → editor ───────────────────────────────────────
    useEffect(() => {
      if (!editor || editor.isDestroyed) return
      if (value === lastEmittedMd.current) return
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
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

    // ── Toolbar config resolution ──────────────────────────────────────────
    const resolvedToolbarConfig: ToolbarConfig | false = useMemo(() => {
      if (minimal || toolbar === false) return false
      if (toolbar === true || toolbar === undefined) return TOOLBAR_CONFIG
      return toolbar
    }, [minimal, toolbar])

    const toolbarActions = useMemo(() => ({
      openLink: () => openLinkRef.current?.(),
      openImage: () => openImageRef.current?.(),
    }), [])

    // ── Render ─────────────────────────────────────────────────────────────
    return (
      <TooltipProvider>
        <div className={cn('wysiwyg-root relative flex flex-col', dark && 'dark', className)}>
          {/* Sticky formatting toolbar */}
          {editor && !readOnly && resolvedToolbarConfig && (
            <div className="sticky top-0 z-10">
              <Toolbar
                editor={editor}
                config={resolvedToolbarConfig}
                actions={toolbarActions}
              />
            </div>
          )}

          <EditorContent editor={editor} className="flex-1 min-h-0" />

          {/* ── Image bubble toolbar ─────────────────────────────────────── */}
          {editor && !readOnly && (
            <ImageBubble
              editor={editor}
              onEdit={() => openImageRef.current?.()}
            />
          )}

          {/* ── Table bubble toolbar ─────────────────────────────────────── */}
          {editor && !readOnly && (
            <TableBubble editor={editor} />
          )}

          {/* ── Selection bubble toolbar ─────────────────────────────────── */}
          {editor && !readOnly && (
            <SelectionBubble
              editor={editor}
              actions={toolbarActions}
            />
          )}

          {/* ── Slash menu portal ─────────────────────────────────────────── */}
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

          {/* ── Link popover form ────────────────────────────────────────── */}
          <LinkPopover
            state={linkPopover}
            onSave={handleLinkSave}
            onRemove={handleLinkRemove}
            onClose={handleLinkClose}
          />

          {/* ── Image popover form ───────────────────────────────────────── */}
          <ImagePopover
            state={imagePopover}
            onSave={handleImageSave}
            onRemove={handleImageRemove}
            onClose={handleImageClose}
          />
        </div>
      </TooltipProvider>
    )
  },
)

export default WysiwygEditor
