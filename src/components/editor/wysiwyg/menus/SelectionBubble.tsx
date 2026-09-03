/**
 * wysiwyg/menus/SelectionBubble.tsx
 *
 * Floating selection toolbar — appears above non-empty text selections.
 *
 * shouldShow rules (mirrors gravity-ui SelectionContext):
 *   - selection is non-empty (from !== to)
 *   - is a TextSelection (not NodeSelection or CellSelection)
 *   - editor is focused
 *   - neither $from nor $to parent is a codeBlock
 *   - not inside an image node
 *   - not a table CellSelection
 *
 * Drag-suppression strategy
 * ─────────────────────────
 * We do NOT gate on mouse state inside shouldShow. Reason: TipTap's BubbleMenu
 * plugin (@tiptap/extension-bubble-menu) calls shouldShow only from its
 * ProseMirror plugin-view update() — and for non-empty selections that path is
 * debounced by updateDelay=250ms (handleDebouncedUpdate → updateHandler). The
 * updateHandler also early-returns when neither selection nor doc changed. So:
 *   1. user holds mousedown >250ms while dragging → debounced update fires →
 *      shouldShow returns false → bubble hidden
 *   2. user releases mouse → mouseup fires, but no PM transaction means no new
 *      update() call → shouldShow is never re-evaluated → bubble stays hidden
 *
 * Fix: shouldShow is always allowed to show (if text selected, etc.).
 * Instead we track dragging with React state (useState) and hide the toolbar
 * *content* via CSS visibility while dragging. On mouseup React re-renders and
 * the toolbar becomes visible — no PM transaction required.
 *
 * The document mousedown listener only sets dragging=true when the event target
 * is inside editor.view.dom, so clicking toolbar buttons never triggers the
 * dragging state.
 *
 * Mutual exclusivity with ImageBubble and TableBubble:
 *   - This bubble gates on non-empty TextSelection → never shows for image node
 *     selection (NodeSelection) or table CellSelection.
 *   - TableBubble shows only for empty selections or CellSelections → never clashes.
 *
 * Contents:
 *   heading/paragraph dropdown (reuses heading list from TOOLBAR_CONFIG)
 *   bold, italic, strike, inline-code toggles
 *   link button
 */

import { useState, useEffect, type ComponentType } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading,
  ChevronDown,
  Link,
} from 'lucide-react'
import { Toggle } from '@/components/ui/toggle'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatHotkey, HEADING_ITEMS } from '../toolbar/config'
import type { ToolbarActions } from '../toolbar/config'

// ---------------------------------------------------------------------------
// Heading list items from TOOLBAR_CONFIG (exported named constant)
// ---------------------------------------------------------------------------

// HEADING_ITEMS is exported from config.ts for resilience against ordering changes

// ---------------------------------------------------------------------------
// SelectionBubble
// ---------------------------------------------------------------------------

interface SelectionBubbleProps {
  editor: Editor
  actions?: ToolbarActions
}

export function SelectionBubble({ editor, actions }: SelectionBubbleProps) {
  // Track whether the user is actively dragging a selection. When true, we
  // hide the toolbar *content* via visibility:hidden (the BubbleMenu element
  // stays mounted and positioned). On mouseup React re-renders and shows it —
  // no ProseMirror transaction required. We scope the mousedown to targets
  // inside editor.view.dom so clicking toolbar buttons never sets dragging=true.
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (editor.view.dom.contains(e.target as Node)) {
        setDragging(true)
      }
    }
    function onMouseUp() {
      setDragging(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [editor])

  // Compute active/enabled flags for the inline mark buttons
  const { boldActive, italicActive, strikeActive, codeActive, linkActive } =
    useEditorState({
      editor,
      selector: ({ editor: e }) => ({
        boldActive:   e?.isActive('bold')      ?? false,
        italicActive: e?.isActive('italic')    ?? false,
        strikeActive: e?.isActive('strike')    ?? false,
        codeActive:   e?.isActive('code')      ?? false,
        linkActive:   e?.isActive('link')      ?? false,
      }),
    })

  // Active heading item for the dropdown label
  const activeHeadingId = HEADING_ITEMS.find((item) => item.isActive?.(editor))?.id

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="selectionBubble"
      options={{ placement: 'top' }}
      shouldShow={({ editor: e, state }) => {
        const { selection } = state

        // Must be a non-empty TextSelection
        if (!(selection instanceof TextSelection)) return false
        if (selection.from === selection.to) return false

        // Editor must be focused
        if (!e.isFocused) return false

        // Neither anchor nor head parent should be a codeBlock
        if (
          selection.$from.parent.type.name === 'codeBlock' ||
          selection.$to.parent.type.name === 'codeBlock'
        ) return false

        // Not inside an image
        if (e.isActive('image')) return false

        // Not a CellSelection (already covered by TextSelection check, but belt+braces)
        if ('isCellSelection' in selection && (selection as unknown as { isCellSelection: boolean }).isCellSelection) return false

        return true
      }}
    >
      {/*
        onMouseDown preventDefault: prevents the editor from losing focus when
        the user clicks a toolbar button, keeping editor.isFocused=true.
        The BubbleMenu plugin also has its own capture-phase mousedown handler on
        this element that sets preventHide=true so the blur handler won't hide it,
        but this is belt-and-suspenders to avoid the blur entirely.
      */}
      <div
        className="wysiwyg-bubble-toolbar wysiwyg-selection-bubble"
        role="toolbar"
        aria-label="Selection toolbar"
        onMouseDown={(e) => e.preventDefault()}
        style={{ visibility: dragging ? 'hidden' : 'visible' }}
      >
        {/* Heading / paragraph dropdown */}
        <HeadingDropdown editor={editor} activeId={activeHeadingId} />

        <Separator orientation="vertical" className="h-4 mx-0.5" />

        {/* Inline mark toggles */}
        <MarkToggle
          label="Bold"
          hotkey="Ctrl+B"
          active={boldActive}
          icon={Bold}
          onToggle={() => editor.chain().focus().toggleBold().run()}
        />
        <MarkToggle
          label="Italic"
          hotkey="Ctrl+I"
          active={italicActive}
          icon={Italic}
          onToggle={() => editor.chain().focus().toggleItalic().run()}
        />
        <MarkToggle
          label="Strikethrough"
          hotkey="Ctrl+Shift+S"
          active={strikeActive}
          icon={Strikethrough}
          onToggle={() => editor.chain().focus().toggleStrike().run()}
        />
        <MarkToggle
          label="Inline Code"
          hotkey="Ctrl+E"
          active={codeActive}
          icon={Code}
          onToggle={() => editor.chain().focus().toggleCode().run()}
        />

        <Separator orientation="vertical" className="h-4 mx-0.5" />

        {/* Link button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={linkActive}
              onPressedChange={() => actions?.openLink?.()}
              aria-label="Link"
            >
              <Link className="h-3.5 w-3.5" />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {`Link  ${formatHotkey('Ctrl+K')}`}
          </TooltipContent>
        </Tooltip>
      </div>
    </BubbleMenu>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface MarkToggleProps {
  label: string
  hotkey?: string
  active: boolean
  icon: ComponentType<{ className?: string }>
  onToggle: () => void
}

function MarkToggle({ label, hotkey, active, icon: Icon, onToggle }: MarkToggleProps) {
  const tip = hotkey ? `${label}  ${formatHotkey(hotkey)}` : label
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={active}
          onPressedChange={onToggle}
          aria-label={label}
        >
          <Icon className="h-3.5 w-3.5" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}

interface HeadingDropdownProps {
  editor: Editor
  activeId: string | undefined
}

function HeadingDropdown({ editor, activeId }: HeadingDropdownProps) {
  const activeItem = HEADING_ITEMS.find((i) => i.id === activeId)
  const Icon = activeItem?.icon ?? Heading

  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              className={`inline-flex items-center gap-0.5 h-8 px-1.5 rounded-md text-sm font-medium transition-colors outline-none
                hover:bg-muted hover:text-muted-foreground
                focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50
                disabled:pointer-events-none disabled:opacity-50
                ${activeId ? 'bg-accent text-accent-foreground' : 'bg-transparent'}
              `}
              aria-label="Heading / paragraph"
            >
              <Icon className="h-3.5 w-3.5" />
              <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          Paragraph / Heading
        </TooltipContent>
        <DropdownMenuContent align="start" className="min-w-[170px]">
          {HEADING_ITEMS.map((item) => {
            const ItemIcon = item.icon
            const hotkeyLabel = item.hotkey ? formatHotkey(item.hotkey) : undefined
            const isActive = item.id === activeId
            return (
              <DropdownMenuItem
                key={item.id}
                onSelect={() => item.exec(editor)}
                className={isActive ? 'bg-accent/50' : ''}
              >
                <ItemIcon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{item.title}</span>
                {hotkeyLabel && (
                  <DropdownMenuShortcut className="font-mono text-[10px]">
                    {hotkeyLabel}
                  </DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  )
}
