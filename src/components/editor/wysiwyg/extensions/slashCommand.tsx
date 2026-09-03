/**
 * wysiwyg/extensions/slashCommand.ts
 *
 * Slash menu Suggestion extension. The menu UI (SlashMenuPortal / SlashMenuInner)
 * is co-located here since it is tightly coupled to the extension state.
 *
 * Slash commands are now derived from SLASH_ITEMS exported by the toolbar
 * config (same item objects, reused). This keeps a single source of truth.
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import type {
  SuggestionOptions,
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion'
import { SLASH_ITEMS } from '../toolbar/config'
import type { ToolbarItem } from '../toolbar/config'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Slash command type (subset of ToolbarItem with action)
// ---------------------------------------------------------------------------

/** A slash command is a flat ToolbarItem (not a list button). */
export type SlashCommand = ToolbarItem & {
  /** Link/image commands need popover openers rather than editor.chain() */
  _needsOpenLink?: boolean
  _needsOpenImage?: boolean
}

// ---------------------------------------------------------------------------
// Slash menu UI
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
  handleRef: MutableRefObject<SlashMenuHandle | null>
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
        items.map((item, idx) => {
          const ItemIcon = item.icon
          return (
            <button
              key={item.id}
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
              <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-muted text-muted-foreground">
                <ItemIcon className="h-3.5 w-3.5" />
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-xs font-medium truncate">{item.title}</span>
                {item.description && (
                  <span className="text-[10px] text-muted-foreground truncate leading-tight">
                    {item.description}
                  </span>
                )}
              </span>
            </button>
          )
        })
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
// Slash command Suggestion extension builder
// ---------------------------------------------------------------------------

export {
  SlashMenuPortal,
  SlashMenuInner,
  type SlashMenuState,
  type SlashMenuHandle,
}

export function buildSlashExtension(
  setMenuRef: MutableRefObject<((s: SlashMenuState | null) => void) | null>,
  handleRef: MutableRefObject<SlashMenuHandle | null>,
  openLinkRef: MutableRefObject<(() => void) | null>,
  openImageRef: MutableRefObject<(() => void) | null>,
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
            props.exec(editor, {
              openLink: () => openLinkRef.current?.(),
              openImage: () => openImageRef.current?.(),
            })
          },
          items({ query }: { query: string }): SlashCommand[] {
            const q = query.toLowerCase()
            if (!q) return SLASH_ITEMS
            return SLASH_ITEMS.filter(
              (c) =>
                c.title.toLowerCase().includes(q) ||
                (c.keywords?.some((k) => k.includes(q)) ?? false),
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
