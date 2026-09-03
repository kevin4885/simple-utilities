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
  EDITOR_MODES,
  toSafeFilename,
  KEYBOARD_SHORTCUTS,
} from './logic'
import { MARKDOWN_LINK_REGEX } from '@/components/editor/WysiwygEditor'

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

describe('EDITOR_MODES', () => {
  it('lists the four modes in display order with unique ids', () => {
    expect(EDITOR_MODES.map((m) => m.id)).toEqual(['wysiwyg', 'markdown', 'preview', 'split'])
    expect(new Set(EDITOR_MODES.map((m) => m.id)).size).toBe(EDITOR_MODES.length)
  })
  it('every mode has a non-empty label and title', () => {
    for (const m of EDITOR_MODES) {
      expect(m.label.length).toBeGreaterThan(0)
      expect(m.title.length).toBeGreaterThan(0)
    }
  })
  it('getModeLabel reads from EDITOR_MODES', () => {
    for (const m of EDITOR_MODES) expect(getModeLabel(m.id)).toBe(m.label)
  })
})

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

// ---------------------------------------------------------------------------
// KEYBOARD_SHORTCUTS constant
// ---------------------------------------------------------------------------

describe('KEYBOARD_SHORTCUTS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(KEYBOARD_SHORTCUTS)).toBe(true)
    expect(KEYBOARD_SHORTCUTS.length).toBeGreaterThan(0)
  })

  it('every entry has keys, description, and category', () => {
    KEYBOARD_SHORTCUTS.forEach((s) => {
      expect(typeof s.keys).toBe('string')
      expect(s.keys.length).toBeGreaterThan(0)
      expect(typeof s.description).toBe('string')
      expect(s.description.length).toBeGreaterThan(0)
      expect(typeof s.category).toBe('string')
      expect(s.category.length).toBeGreaterThan(0)
    })
  })

  it('includes Ctrl+K for link', () => {
    const found = KEYBOARD_SHORTCUTS.find((s) => s.keys.includes('Ctrl+K'))
    expect(found).toBeDefined()
    expect(found?.description.toLowerCase()).toMatch(/link/)
  })

  it('includes Ctrl+Shift+K for unlink', () => {
    const found = KEYBOARD_SHORTCUTS.find((s) => s.keys.includes('Ctrl+Shift+K'))
    expect(found).toBeDefined()
    expect(found?.description.toLowerCase()).toMatch(/unlink|remove/)
  })

  it('includes Ctrl+Z for undo', () => {
    const found = KEYBOARD_SHORTCUTS.find((s) => s.keys.includes('Ctrl+Z'))
    expect(found).toBeDefined()
    expect(found?.description.toLowerCase()).toMatch(/undo/)
  })

  it('includes Ctrl+Alt+P for toggle preview (not Ctrl+Shift+P)', () => {
    const found = KEYBOARD_SHORTCUTS.find((s) => s.category === 'View' && s.keys.includes('Ctrl+Alt+P'))
    expect(found).toBeDefined()
    expect(found?.description.toLowerCase()).toMatch(/preview/)
    // Must NOT have the old Ctrl+Shift+P binding (Firefox private-window conflict)
    const oldBinding = KEYBOARD_SHORTCUTS.find((s) => s.keys.includes('Ctrl+Shift+P'))
    expect(oldBinding).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// MARKDOWN_LINK_REGEX — input rule for [text](url) conversion
// ---------------------------------------------------------------------------

describe('MARKDOWN_LINK_REGEX', () => {
  // Positive cases — should match
  it('matches [text](url) followed by a space', () => {
    const m = '[Click here](https://example.com) '.match(MARKDOWN_LINK_REGEX)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('Click here')
    expect(m![2]).toBe('https://example.com')
  })

  it('matches [text](url) at end of string (no trailing space)', () => {
    const m = '[Click here](https://example.com)'.match(MARKDOWN_LINK_REGEX)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('Click here')
  })

  it('matches multi-word link text', () => {
    const m = '[My Great Link](https://foo.bar) '.match(MARKDOWN_LINK_REGEX)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('My Great Link')
    expect(m![2]).toBe('https://foo.bar')
  })

  it('matches relative url', () => {
    const m = '[Home](/home) '.match(MARKDOWN_LINK_REGEX)
    expect(m).not.toBeNull()
    expect(m![2]).toBe('/home')
  })

  it('matches bare domain', () => {
    const m = '[Google](google.com) '.match(MARKDOWN_LINK_REGEX)
    expect(m).not.toBeNull()
    expect(m![2]).toBe('google.com')
  })

  // Negative cases — should NOT match
  it('does NOT match task list [ ] (empty checkbox)', () => {
    const m = '- [ ] task'.match(MARKDOWN_LINK_REGEX)
    expect(m).toBeNull()
  })

  it('does NOT match task list [x] (checked checkbox)', () => {
    const m = '- [x] done'.match(MARKDOWN_LINK_REGEX)
    expect(m).toBeNull()
  })

  it('does NOT match [foo] without parenthesised url', () => {
    const m = '[foo] bar'.match(MARKDOWN_LINK_REGEX)
    expect(m).toBeNull()
  })

  it('does NOT match when url is empty [text]()', () => {
    const m = '[text]() '.match(MARKDOWN_LINK_REGEX)
    expect(m).toBeNull()
  })

  it('does NOT match plain text without bracket syntax', () => {
    const m = 'hello world'.match(MARKDOWN_LINK_REGEX)
    expect(m).toBeNull()
  })
})
