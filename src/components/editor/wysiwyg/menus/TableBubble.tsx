/**
 * wysiwyg/menus/TableBubble.tsx
 *
 * Table bubble toolbar — appears above the table when cursor is inside a table
 * AND the selection is EMPTY or is a CellSelection (not a non-empty TextSelection
 * outside a cell). The SelectionBubble handles non-empty text selections.
 *
 * shouldShow: e.isActive('table') && !e.isActive('image')
 *   AND (selection is empty OR is a CellSelection)
 *
 * This ensures mutual exclusivity with SelectionBubble.
 */

import { BubbleMenu } from '@tiptap/react/menus'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import {
  RowsIcon,
  TableIcon,
  Columns3Icon,
  MinusIcon,
  PlusIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TableBubbleProps {
  editor: Editor
}

export function TableBubble({ editor }: TableBubbleProps) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubble"
      options={{ placement: 'top' }}
      shouldShow={({ editor: e }) => {
        if (!e.isActive('table') || e.isActive('image')) return false
        const { selection } = e.state
        // Show when selection is empty (cursor only) or is a CellSelection.
        // TextSelection with from !== to means text is selected — defer to SelectionBubble.
        if (selection instanceof TextSelection && selection.from !== selection.to) {
          return false
        }
        return true
      }}
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
  )
}
