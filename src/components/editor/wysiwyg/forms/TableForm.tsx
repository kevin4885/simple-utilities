/**
 * wysiwyg/forms/TableForm.tsx
 *
 * TableForm — grid picker UI for inserting tables.
 * Rendered inside WidgetPopover when kind === 'table'.
 *
 * Features:
 *  - 8×8 hover grid: hover cells to preview size, click to insert
 *  - Arrow keys move the highlighted size (via tableGrid.ts reducer)
 *  - Enter inserts at the highlighted size
 *  - Escape cancels
 *  - "Header row" checkbox
 *  - Live label showing "3 × 4"
 */

import { useState, useRef, useEffect } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { nextSize, TABLE_GRID_MAX } from './tableGrid'
import type { TableGridSize } from './tableGrid'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TableFormProps {
  onInsert: (rows: number, cols: number, withHeaderRow: boolean) => void
  onClose: () => void
}

// ---------------------------------------------------------------------------
// TableForm
// ---------------------------------------------------------------------------

export function TableForm({ onInsert, onClose }: TableFormProps) {
  const [hovered, setHovered] = useState<TableGridSize>({ rows: 1, cols: 1 })
  const [withHeaderRow, setWithHeaderRow] = useState(true)
  // gridRef used to capture arrow-key focus without stealing from the checkbox
  const gridRef = useRef<HTMLDivElement>(null)

  // Focus the grid on mount for immediate keyboard control
  useEffect(() => {
    setTimeout(() => gridRef.current?.focus(), 50)
  }, [])

  function handleInsert(rows: number, cols: number) {
    onInsert(rows, cols, withHeaderRow)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      handleInsert(hovered.rows, hovered.cols)
      return
    }
    const next = nextSize(hovered, e.key)
    if (next !== hovered) {
      e.preventDefault()
      setHovered(next)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Insert table</span>
        <span className="text-xs tabular-nums text-muted-foreground min-w-[3rem] text-right">
          {hovered.rows} × {hovered.cols}
        </span>
      </div>

      {/* Grid picker */}
      <div
        ref={gridRef}
        role="grid"
        aria-label={`Table size picker ${hovered.rows} by ${hovered.cols}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="focus:outline-none"
      >
        <div
          className="inline-grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${TABLE_GRID_MAX}, 1fr)` }}
        >
          {Array.from({ length: TABLE_GRID_MAX }, (_, r) =>
            Array.from({ length: TABLE_GRID_MAX }, (_, c) => {
              const row = r + 1
              const col = c + 1
              const isHighlighted = row <= hovered.rows && col <= hovered.cols
              return (
                <button
                  key={`${row}-${col}`}
                  role="gridcell"
                  aria-selected={isHighlighted}
                  aria-label={`${row} rows, ${col} columns`}
                  tabIndex={-1}
                  className={cn(
                    'w-5 h-5 rounded-sm border transition-colors',
                    isHighlighted
                      ? 'bg-primary border-primary'
                      : 'bg-muted/60 border-input hover:border-primary/60 hover:bg-primary/10',
                  )}
                  onMouseEnter={() => setHovered({ rows: row, cols: col })}
                  onClick={() => handleInsert(row, col)}
                />
              )
            }),
          )}
        </div>
      </div>

      {/* Header row checkbox */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="wysiwyg-table-header"
          checked={withHeaderRow}
          onCheckedChange={(checked) => setWithHeaderRow(checked === true)}
        />
        <Label htmlFor="wysiwyg-table-header" className="text-xs cursor-pointer">
          Header row
        </Label>
      </div>

      <p className="text-[10px] text-muted-foreground leading-tight -mt-1">
        Hover to preview · click or press Enter to insert · arrow keys to adjust
      </p>
    </div>
  )
}
