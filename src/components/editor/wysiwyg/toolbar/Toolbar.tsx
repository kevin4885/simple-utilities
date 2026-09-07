/**
 * wysiwyg/toolbar/Toolbar.tsx
 *
 * Renders the data-driven toolbar config. Uses useEditorState from @tiptap/react
 * so the toolbar only re-renders when active/enabled flags actually change.
 *
 * Groups are separated by vertical Separators.
 * ToolbarItem      → shadcn Toggle (sm, pressed=isActive, disabled=!isEnabled)
 * ToolbarListButton → shadcn DropdownMenu trigger button (icon + chevron)
 *                    items show icon + title + hotkey right-aligned in muted mono.
 * Every button wrapped in shadcn Tooltip showing "Title  Ctrl+B".
 */

import { memo } from 'react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { ChevronDown } from 'lucide-react'
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
import {
  TOOLBAR_CONFIG,
  formatHotkey,
} from './config'
import type {
  ToolbarConfig,
  ToolbarItem,
  ToolbarListButton,
  ToolbarActions,
} from './config'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ToolbarProps {
  editor: Editor
  config?: ToolbarConfig
  actions?: ToolbarActions
  className?: string
}

// ---------------------------------------------------------------------------
// Single item state selector key for useEditorState
// ---------------------------------------------------------------------------

interface ToolbarState {
  /** Map of item id → { active, enabled } */
  flags: Record<string, { active: boolean; enabled: boolean }>
}

function buildFlags(editor: Editor, config: ToolbarConfig): ToolbarState['flags'] {
  const flags: ToolbarState['flags'] = {}
  for (const group of config) {
    for (const entry of group) {
      if ('type' in entry && entry.type === 'list') {
        for (const item of (entry as ToolbarListButton).items) {
          flags[item.id] = {
            active: item.isActive?.(editor) ?? false,
            enabled: item.isEnabled?.(editor) ?? true,
          }
        }
      } else {
        const item = entry as ToolbarItem
        flags[item.id] = {
          active: item.isActive?.(editor) ?? false,
          enabled: item.isEnabled?.(editor) ?? true,
        }
      }
    }
  }
  return flags
}

// ---------------------------------------------------------------------------
// Toolbar — main component
// ---------------------------------------------------------------------------

export const Toolbar = memo(function Toolbar({
  editor,
  config = TOOLBAR_CONFIG,
  actions,
  className,
}: ToolbarProps) {
  // Compute active/enabled flags in one selector — re-renders only when flags change.
  const { flags } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      flags: e ? buildFlags(e, config) : {},
    }),
  })

  return (
    <div
      className={`wysiwyg-toolbar flex flex-wrap items-center gap-0.5 px-1.5 py-1 bg-card border-b border-border shrink-0 ${className ?? ''}`}
      data-testid="wysiwyg-toolbar"
      role="toolbar"
      aria-label="Formatting toolbar"
    >
      {config.map((group, gi) => (
        <span key={gi} className="flex items-center gap-0.5">
          {gi > 0 && (
            <Separator
              orientation="vertical"
              className="h-5 mx-0.5"
            />
          )}
          {group.map((entry) => {
            if ('type' in entry && entry.type === 'list') {
              return (
                <ListButtonEntry
                  key={(entry as ToolbarListButton).id}
                  entry={entry as ToolbarListButton}
                  flags={flags}
                  editor={editor}
                  actions={actions}
                />
              )
            }
            const item = entry as ToolbarItem
            const flag = flags[item.id] ?? { active: false, enabled: true }
            return (
              <ItemButton
                key={item.id}
                item={item}
                active={flag.active}
                enabled={flag.enabled}
                editor={editor}
                actions={actions}
              />
            )
          })}
        </span>
      ))}
    </div>
  )
})

// ---------------------------------------------------------------------------
// ItemButton — a single toggle button
// ---------------------------------------------------------------------------

interface ItemButtonProps {
  item: ToolbarItem
  active: boolean
  enabled: boolean
  editor: Editor
  actions?: ToolbarActions
}

function ItemButton({ item, active, enabled, editor, actions }: ItemButtonProps) {
  const Icon = item.icon
  const hotkeyLabel = item.hotkey ? formatHotkey(item.hotkey) : undefined
  const tooltipLabel = hotkeyLabel ? `${item.title}  ${hotkeyLabel}` : item.title

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={active}
          disabled={!enabled}
          onPressedChange={() => item.exec(editor, actions)}
          aria-label={item.title}
          data-item-id={item.id}
        >
          <Icon className="h-3.5 w-3.5" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// ListButtonEntry — a dropdown menu for list-type toolbar buttons
// ---------------------------------------------------------------------------

interface ListButtonEntryProps {
  entry: ToolbarListButton
  flags: ToolbarState['flags']
  editor: Editor
  actions?: ToolbarActions
}

function ListButtonEntry({ entry, flags, editor, actions }: ListButtonEntryProps) {
  // Check if any non-excluded child item is active → treat parent as active.
  // Items flagged `excludeFromGroupActive` (e.g. "Paragraph" — the dropdown's
  // default/reset option) are still highlighted for themselves inside the
  // open menu but must not light up the parent trigger icon.
  const anyActive = entry.items
    .filter((item) => !item.excludeFromGroupActive)
    .some((item) => flags[item.id]?.active ?? false)
  const TriggerIcon = entry.icon
  const tooltipLabel = entry.title

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
                ${anyActive ? 'bg-accent text-accent-foreground' : 'bg-transparent'}
              `}
              aria-label={tooltipLabel}
              data-list-id={entry.id}
            >
              <TriggerIcon className="h-3.5 w-3.5" />
              <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {tooltipLabel}
        </TooltipContent>
        <DropdownMenuContent align="start" className="min-w-[180px]" onCloseAutoFocus={(e) => { e.preventDefault(); editor.commands.focus() }}>
          {entry.items.map((item) => {
            const Icon = item.icon
            const flag = flags[item.id] ?? { active: false, enabled: true }
            const hotkeyLabel = item.hotkey ? formatHotkey(item.hotkey) : undefined
            return (
              <DropdownMenuItem
                key={item.id}
                disabled={!flag.enabled}
                onSelect={() => { item.exec(editor, actions); editor.commands.focus() }}
                className={flag.active ? 'bg-accent/50' : ''}
                data-item-id={item.id}
              >
                <Icon className="h-4 w-4 shrink-0" />
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
