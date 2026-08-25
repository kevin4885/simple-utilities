import { describe, it, expect } from 'vitest'
import {
  // Re-exports from markdown-editor/logic
  countWords,
  countChars,
  countLines,
  generateDocTitle,
  pruneAutoVersions,
  formatVersionTime,
  AUTO_VERSION_CAP,
  // VME-specific
  getModeLabel,
  toSafeFilename,
  PALETTE_GROUPS,
  type PaletteGroup,
} from './logic'

// ---------------------------------------------------------------------------
// Re-exported helpers (sanity-check they still work)
// ---------------------------------------------------------------------------

describe('countWords', () => {
  it('counts words correctly', () => {
    expect(countWords('hello world')).toBe(2)
  })
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0)
  })
  it('handles extra whitespace', () => {
    expect(countWords('  foo   bar  ')).toBe(2)
  })
})

describe('countChars', () => {
  it('returns raw string length', () => {
    expect(countChars('hello')).toBe(5)
    expect(countChars('')).toBe(0)
  })
})

describe('countLines', () => {
  it('counts newline-separated lines', () => {
    expect(countLines('a\nb\nc')).toBe(3)
  })
  it('returns 0 for empty string', () => {
    expect(countLines('')).toBe(0)
  })
  it('returns 1 for single line', () => {
    expect(countLines('hello')).toBe(1)
  })
})

describe('generateDocTitle', () => {
  it('starts at Untitled 1 for empty list', () => {
    expect(generateDocTitle([])).toBe('Untitled 1')
  })
  it('skips taken titles', () => {
    expect(generateDocTitle(['Untitled 1', 'Untitled 2'])).toBe('Untitled 3')
  })
  it('fills gaps', () => {
    expect(generateDocTitle(['Untitled 1', 'Untitled 3'])).toBe('Untitled 2')
  })
})

describe('pruneAutoVersions', () => {
  function makeVersions(count: number, auto: boolean) {
    return Array.from({ length: count }, (_, i) => ({
      id: `v${i}`,
      auto,
    }))
  }

  it('keeps pinned versions regardless of cap', () => {
    const pinned = makeVersions(10, false)
    const result = pruneAutoVersions(pinned, 3)
    expect(result).toHaveLength(10)
  })

  it('prunes auto versions beyond cap', () => {
    const autos = makeVersions(60, true)
    const result = pruneAutoVersions(autos, AUTO_VERSION_CAP)
    expect(result).toHaveLength(AUTO_VERSION_CAP)
  })

  it('keeps pinned + up to cap auto', () => {
    const versions = [
      ...makeVersions(3, false),  // pinned
      ...makeVersions(5, true),   // auto
    ]
    const result = pruneAutoVersions(versions, 3)
    // 3 pinned always kept, only first 3 auto kept
    expect(result).toHaveLength(6)
    expect(result.filter((v) => !v.auto)).toHaveLength(3)
    expect(result.filter((v) => v.auto)).toHaveLength(3)
  })
})

describe('formatVersionTime', () => {
  const base = new Date('2024-01-15T12:00:00').getTime()

  it('returns "Just now" for < 1 min', () => {
    expect(formatVersionTime(base, base + 30_000)).toBe('Just now')
  })

  it('returns "X min ago" for < 1 hour', () => {
    expect(formatVersionTime(base, base + 5 * 60_000)).toBe('5 min ago')
  })

  it('returns "Xh ago" for < 24 hours', () => {
    expect(formatVersionTime(base, base + 3 * 3_600_000)).toBe('3h ago')
  })

  it('returns "Yesterday at HH:MM" for 1 day ago', () => {
    const result = formatVersionTime(base, base + 86_400_000)
    expect(result).toMatch(/^Yesterday at/)
  })
})

// ---------------------------------------------------------------------------
// VME-specific helpers
// ---------------------------------------------------------------------------

describe('getModeLabel', () => {
  it('returns correct labels', () => {
    expect(getModeLabel('wysiwyg')).toBe('Visual')
    expect(getModeLabel('markdown')).toBe('Markdown')
    expect(getModeLabel('preview')).toBe('Preview')
  })
})

describe('toSafeFilename', () => {
  it('converts spaces to hyphens', () => {
    expect(toSafeFilename('My Document')).toBe('my-document')
  })
  it('strips special chars', () => {
    expect(toSafeFilename('hello/world!')).toBe('hello-world')
  })
  it('collapses multiple hyphens', () => {
    expect(toSafeFilename('foo -- bar')).toBe('foo-bar')
  })
  it('strips leading/trailing hyphens', () => {
    expect(toSafeFilename('  hello  ')).toBe('hello')
  })
  it('lowercases result', () => {
    expect(toSafeFilename('Hello World')).toBe('hello-world')
  })
  it('handles empty string', () => {
    expect(toSafeFilename('')).toBe('')
  })
})

describe('PALETTE_GROUPS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(PALETTE_GROUPS)).toBe(true)
    expect(PALETTE_GROUPS.length).toBeGreaterThan(0)
  })

  it('every group has a name and non-empty items array', () => {
    PALETTE_GROUPS.forEach((group: PaletteGroup) => {
      expect(typeof group.group).toBe('string')
      expect(group.group.length).toBeGreaterThan(0)
      expect(Array.isArray(group.items)).toBe(true)
      expect(group.items.length).toBeGreaterThan(0)
    })
  })

  it('every item has required fields', () => {
    PALETTE_GROUPS.forEach((group: PaletteGroup) => {
      group.items.forEach((item) => {
        expect(typeof item.label).toBe('string')
        expect(typeof item.snippet).toBe('string')
        expect(item.snippet.length).toBeGreaterThan(0)
      })
    })
  })

  it('includes Headings and Lists groups', () => {
    const groupNames = PALETTE_GROUPS.map((g) => g.group)
    expect(groupNames).toContain('Headings')
    expect(groupNames).toContain('Lists')
  })
})
