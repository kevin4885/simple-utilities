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
 * Phase 2 changes:
 *   • widgetFormExtension — ProseMirror plugin that renders in-document
 *     widget chips as Decoration.widget(); React side via WidgetPopover.
 *   • WidgetPopover replaces LinkPopover + ImagePopover (no more frozen
 *     position:fixed rect snapshot; Radix virtualRef follows on scroll).
 *   • TableForm — interactive grid picker for table insertion.
 *   • ImageForm — added drag-and-drop / file picker, reads files as data URIs.
 *   • Paste/drop image files → data URI nodes inserted into the editor.
 *   • openTableRef — table toolbar item and slash menu call openTableWidget.
 *   • ImageBubble "Edit" routes through widgetForm edit mode.
 * Phase 3 changes:
 *   • tableControlsExtension — replaces TableBubble with hover row/column
 *     handles + edge "+" buttons (gravity-ui/Notion style).
 *   • TableControls overlay — absolutely positioned inside wysiwyg-root.
 *   • TableBubble removed.
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
import Placeholder from '@tiptap/extension-placeholder'
import type { MarkdownStorage } from 'tiptap-markdown'
import type { Editor } from '@tiptap/core'
import { cn } from '@/lib/utils'
import { TooltipProvider } from '@/components/ui/tooltip'
import { buildCoreExtensions } from './coreExtensions'

// Submodules
import { buildSlashExtension, SlashMenuPortal } from './extensions/slashCommand'
import type { SlashMenuState, SlashMenuHandle } from './extensions/slashCommand'
import { buildLinkKeyboardExtension } from './extensions/linkKeyboard'
import { widgetFormExtension } from './extensions/widgetForm'
import { tableControlsExtension } from './extensions/tableControls'
import { TableControls } from './extensions/tableControls/TableControls'
import { WidgetPopover } from './forms/WidgetPopover'
import { openLinkWidget, openImageWidget, openTableWidget } from './forms/WidgetPopover'
import { ImageBubble } from './menus/ImageBubble'
import { SelectionBubble } from './menus/SelectionBubble'
import { Toolbar } from './toolbar/Toolbar'
import { TOOLBAR_CONFIG } from './toolbar/config'
import type { ToolbarConfig } from './toolbar/config'
import { isImageFile, fileToDataUri } from './forms/imageFile'
import { sanitizeImageSrc } from './utils'

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

    // ── Widget form opener refs (injected into slash / keyboard extensions) ─
    const openLinkRef = useRef<(() => void) | null>(null)
    const openImageRef = useRef<(() => void) | null>(null)
    const openTableRef = useRef<(() => void) | null>(null)

    // ── Prop ref — read inside Placeholder callback so live updates work ─────
    // placeholder: Placeholder.configure accepts a function, so we pass
    //   () => placeholderRef.current — any re-render with a new placeholder
    //   prop updates the ref (via the layout effect below) and the next
    //   ProseMirror decoration cycle reads the new value automatically.
    //   readOnly is NOT kept in a ref here — it is applied via setEditable()
    //   in its own useEffect and the Link extension uses openOnClick: false
    //   (constant) because TipTap's built-in editable check already prevents
    //   link clicks when the view is not editable.
    const placeholderRef = useRef(placeholder)
    // Keep ref in sync before paint so the next decoration cycle sees the update.
    useLayoutEffect(() => { placeholderRef.current = placeholder })

    // ── Stable extensions ──────────────────────────────────────────────────
    const [slashExtension] = useState(() =>
      buildSlashExtension(setMenuRef, slashHandleRef, openLinkRef, openImageRef, openTableRef),
    )

    const [linkKeyboardExtension] = useState(() =>
      buildLinkKeyboardExtension(openLinkRef),
    )

    const extensions = useMemo(
      () => [
        // Core serialisation extensions (shared with testUtils via coreExtensions.ts).
        // Includes tableInvariantExtension which enforces the GFM header-row rule.
        ...buildCoreExtensions(),
        // Placeholder accepts a function so placeholder prop changes are live:
        // the closure always reads placeholderRef.current, updated each render.
        Placeholder.configure({ placeholder: () => placeholderRef.current }),
        // Ref/UI-dependent extensions appended after core:
        linkKeyboardExtension,
        widgetFormExtension,
        tableControlsExtension,
        ...(minimal ? [] : [slashExtension]),
      ],
      // Only rebuild extensions when `minimal` changes (which changes the
      // structural extension array). readOnly and placeholder are consumed via
      // refs and applied as side-effects (editor.setEditable, Placeholder fn)
      // so they must NOT be in this dep array — rebuilding on readOnly/placeholder
      // change would destroy and recreate the editor, wiping undo history and
      // losing the current selection.
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
        handlePaste(_view, event) {
          const items = event.clipboardData?.items
          if (!items) return false
          for (const item of Array.from(items)) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
              const file = item.getAsFile()
              if (!file) continue
              event.preventDefault()
              fileToDataUri(file).then((dataUri) => {
                if (!editor || editor.isDestroyed) return
                const safeSrc = sanitizeImageSrc(dataUri)
                if (!safeSrc) return
                editor.chain().focus().setImage({ src: safeSrc, alt: '' }).run()
              })
              return true
            }
          }
          return false
        },
        handleDrop(_view, event) {
          const files = event.dataTransfer?.files
          if (!files || files.length === 0) return false
          const imageFile = Array.from(files).find(isImageFile)
          if (!imageFile) return false
          event.preventDefault()
          fileToDataUri(imageFile).then((dataUri) => {
            if (!editor || editor.isDestroyed) return
            const safeSrc = sanitizeImageSrc(dataUri)
            if (!safeSrc) return
            editor.chain().focus().setImage({ src: safeSrc, alt: '' }).run()
          })
          return true
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

    // ── Populate widget form opener refs ───────────────────────────────────
    useLayoutEffect(() => {
      openLinkRef.current = () => {
        if (!editor) return
        openLinkWidget(editor)
      }
      openImageRef.current = () => {
        if (!editor) return
        openImageWidget(editor)
      }
      openTableRef.current = () => {
        if (!editor) return
        openTableWidget(editor)
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
      // Suppress autolink on programmatic setContent:
      //   Link's autolink appendTransaction runs on every transaction that
      //   changes the document.  When we call setContent to sync an external
      //   value prop change the transaction is NOT a user edit, so we must
      //   pass `preventAutolink: true` meta — otherwise the autolink plugin
      //   can rewrite URLs in the first block (e.g. the last word before a
      //   paragraph break) and the next flush writes back a mutated string.
      //
      //   Implementation: chain().setMeta(...).setContent(...).run() so the
      //   meta is attached to the same transaction that replaces the document.
      editor
        .chain()
        .setMeta('preventAutolink', true)
        .setContent(value, { emitUpdate: false })
        .run()
      lastEmittedMd.current = value
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    // ── Close slash menu ───────────────────────────────────────────────────
    const handleClose = useCallback(() => setSlashMenu(null), [])

    // ── Toolbar config resolution ──────────────────────────────────────────
    const resolvedToolbarConfig: ToolbarConfig | false = useMemo(() => {
      if (minimal || toolbar === false) return false
      if (toolbar === true || toolbar === undefined) return TOOLBAR_CONFIG
      return toolbar
    }, [minimal, toolbar])

    const toolbarActions = useMemo(() => ({
      openLink: () => openLinkRef.current?.(),
      openImage: () => openImageRef.current?.(),
      openTable: () => openTableRef.current?.(),
    }), [])

    // ── Render ─────────────────────────────────────────────────────────────
    return (
      <TooltipProvider>
        <div className={cn('wysiwyg-root relative flex flex-col', dark && 'dark', className)}>
          {/* Sticky formatting toolbar */}
          {editor && !readOnly && resolvedToolbarConfig && (
            <div className="sticky top-0 z-20">
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

          {/* ── Table controls overlay (Phase 3) ─────────────────────────── */}
          {editor && !readOnly && (
            <TableControls editor={editor} />
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

          {/* ── Widget popover (link / image / table) ────────────────────── */}
          {editor && !readOnly && (
            <WidgetPopover editor={editor} />
          )}
        </div>
      </TooltipProvider>
    )
  },
)

export default WysiwygEditor
