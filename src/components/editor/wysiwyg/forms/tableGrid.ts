/**
 * wysiwyg/forms/tableGrid.ts
 *
 * Pure reducer for the table grid picker keyboard navigation.
 * No DOM dependencies — fully unit-testable.
 */

export interface TableGridSize {
  rows: number
  cols: number
}

export const TABLE_GRID_MIN = 1
export const TABLE_GRID_MAX = 8

/**
 * Given the current highlighted size and a keyboard key string,
 * returns the next size (clamped to 1..TABLE_GRID_MAX).
 *
 * Handles: ArrowUp, ArrowDown, ArrowLeft, ArrowRight.
 * Ignores all other keys (returns current size unchanged).
 */
export function nextSize(size: TableGridSize, key: string): TableGridSize {
  const clamp = (v: number) =>
    Math.max(TABLE_GRID_MIN, Math.min(TABLE_GRID_MAX, v))

  switch (key) {
    case 'ArrowUp':
      return { ...size, rows: clamp(size.rows - 1) }
    case 'ArrowDown':
      return { ...size, rows: clamp(size.rows + 1) }
    case 'ArrowLeft':
      return { ...size, cols: clamp(size.cols - 1) }
    case 'ArrowRight':
      return { ...size, cols: clamp(size.cols + 1) }
    default:
      return size
  }
}
