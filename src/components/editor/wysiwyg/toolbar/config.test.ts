/**
 * wysiwyg/toolbar/config.test.ts
 *
 * Unit tests for toolbar/config.ts:
 *   - Every item has a unique id
 *   - Every item has icon + title
 *   - SLASH_ITEMS has no list buttons, includes headings/table/image/link
 *   - formatHotkey Mac/Win formatting
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { TOOLBAR_CONFIG, SLASH_ITEMS, formatHotkey } from './config'
import type { ToolbarItem, ToolbarListButton } from './config'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isListButton(entry: ToolbarItem | ToolbarListButton): entry is ToolbarListButton {
  return 'type' in entry && (entry as ToolbarListButton).type === 'list'
}

function getAllItems(config: typeof TOOLBAR_CONFIG): ToolbarItem[] {
  const items: ToolbarItem[] = []
  for (const group of config) {
    for (const entry of group) {
      if (isListButton(entry)) {
        items.push(...entry.items)
      } else {
        items.push(entry as ToolbarItem)
      }
    }
  }
  return items
}

// ---------------------------------------------------------------------------
// TOOLBAR_CONFIG structure
// ---------------------------------------------------------------------------

describe('TOOLBAR_CONFIG', () => {
  it('is a non-empty array of groups', () => {
    expect(Array.isArray(TOOLBAR_CONFIG)).toBe(true)
    expect(TOOLBAR_CONFIG.length).toBeGreaterThan(0)
    for (const group of TOOLBAR_CONFIG) {
      expect(Array.isArray(group)).toBe(true)
      expect(group.length).toBeGreaterThan(0)
    }
  })

  it('every top-level entry has id and title and icon', () => {
    for (const group of TOOLBAR_CONFIG) {
      for (const entry of group) {
        expect(typeof entry.id).toBe('string')
        expect(entry.id.length).toBeGreaterThan(0)
        expect(typeof entry.title).toBe('string')
        expect(entry.title.length).toBeGreaterThan(0)
        // Lucide icons are forwardRef objects or functions depending on React version
        expect(entry.icon).toBeTruthy()
      }
    }
  })

  it('every list button item has id, title, icon, and exec function', () => {
    for (const group of TOOLBAR_CONFIG) {
      for (const entry of group) {
        if (isListButton(entry)) {
          for (const item of entry.items) {
            expect(typeof item.id).toBe('string')
            expect(item.id.length).toBeGreaterThan(0)
            expect(typeof item.title).toBe('string')
            expect(item.title.length).toBeGreaterThan(0)
            expect(item.icon).toBeTruthy()
            expect(typeof item.exec).toBe('function')
          }
        }
      }
    }
  })

  it('all item ids are unique across the full config', () => {
    const items = getAllItems(TOOLBAR_CONFIG)
    // Top level IDs
    const topIds = TOOLBAR_CONFIG.flat().map((e) => e.id)
    const topSet = new Set(topIds)
    expect(topSet.size).toBe(topIds.length)
    // All item ids (including list children)
    const allIds = items.map((i) => i.id)
    const allSet = new Set(allIds)
    expect(allSet.size).toBe(allIds.length)
  })

  it('includes undo and redo', () => {
    const topIds = TOOLBAR_CONFIG.flat().map((e) => e.id)
    expect(topIds).toContain('undo')
    expect(topIds).toContain('redo')
  })

  it('includes bold, italic, strike, inlineCode at top level', () => {
    const topIds = TOOLBAR_CONFIG.flat().map((e) => e.id)
    expect(topIds).toContain('bold')
    expect(topIds).toContain('italic')
    expect(topIds).toContain('strike')
    expect(topIds).toContain('inlineCode')
  })

  it('includes image, table, horizontalRule in insert group', () => {
    const topIds = TOOLBAR_CONFIG.flat().map((e) => e.id)
    expect(topIds).toContain('image')
    expect(topIds).toContain('table')
    expect(topIds).toContain('horizontalRule')
  })
})

// ---------------------------------------------------------------------------
// SLASH_ITEMS
// ---------------------------------------------------------------------------

describe('SLASH_ITEMS', () => {
  it('is a non-empty flat array', () => {
    expect(Array.isArray(SLASH_ITEMS)).toBe(true)
    expect(SLASH_ITEMS.length).toBeGreaterThan(0)
  })

  it('contains no list buttons (all items are ToolbarItem)', () => {
    for (const item of SLASH_ITEMS) {
      expect('type' in item && (item as { type: string }).type === 'list').toBe(false)
      expect(typeof item.exec).toBe('function')
    }
  })

  it('all ids are unique', () => {
    const ids = SLASH_ITEMS.map((i) => i.id)
    const set = new Set(ids)
    expect(set.size).toBe(ids.length)
  })

  it('every item has icon and title', () => {
    for (const item of SLASH_ITEMS) {
      // Lucide icons are forwardRef objects; just ensure they're truthy
      expect(item.icon).toBeTruthy()
      expect(typeof item.title).toBe('string')
      expect(item.title.length).toBeGreaterThan(0)
    }
  })

  it('includes heading items (h1-h6)', () => {
    const ids = SLASH_ITEMS.map((i) => i.id)
    expect(ids).toContain('heading1')
    expect(ids).toContain('heading2')
    expect(ids).toContain('heading3')
  })

  it('includes image', () => {
    const ids = SLASH_ITEMS.map((i) => i.id)
    expect(ids).toContain('image')
  })

  it('includes table', () => {
    const ids = SLASH_ITEMS.map((i) => i.id)
    expect(ids).toContain('table')
  })

  it('includes link', () => {
    const ids = SLASH_ITEMS.map((i) => i.id)
    expect(ids).toContain('link')
  })

  it('does NOT include undo or redo', () => {
    const ids = SLASH_ITEMS.map((i) => i.id)
    expect(ids).not.toContain('undo')
    expect(ids).not.toContain('redo')
  })
})

// ---------------------------------------------------------------------------
// formatHotkey
// ---------------------------------------------------------------------------

describe('formatHotkey', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns Ctrl+ on Windows/Linux (non-Mac platform)', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    expect(formatHotkey('Ctrl+B')).toBe('Ctrl+B')
    expect(formatHotkey('Ctrl+Shift+K')).toBe('Ctrl+Shift+K')
  })

  it('returns Cmd+ on Mac platform', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    expect(formatHotkey('Ctrl+B')).toBe('Cmd+B')
    expect(formatHotkey('Ctrl+Shift+K')).toBe('Cmd+Shift+K')
  })

  it('handles multiple Ctrl+ occurrences in a pattern', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    // Edge case: pattern with two Ctrl+
    expect(formatHotkey('Ctrl+Ctrl+X')).toBe('Cmd+Cmd+X')
  })
})
