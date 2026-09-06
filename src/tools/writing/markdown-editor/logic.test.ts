import { describe, it, expect } from 'vitest'
import { encode } from 'gpt-tokenizer'
import {
  countTokensGpt,
  countTokensApprox,
  countWords,
  countChars,
  countLines,
  generateDocTitle,
  pruneAutoVersions,
  pruneRestoreSnapshots,
  formatVersionTime,
  AUTO_VERSION_CAP,
  RESTORE_SNAPSHOT_CAP,
  RESTORE_SNAPSHOT_LABEL,
  // VME-specific
  getModeLabel,
  EDITOR_MODES,
  toSafeFilename,
  KEYBOARD_SHORTCUTS,
  migrateLegacyStorage,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  type StorageLike,
} from './logic'
import { MARKDOWN_LINK_REGEX } from '@/components/editor/WysiwygEditor'

// ---------------------------------------------------------------------------
// Local helpers (owned by the VME — no cross-import from markdown-editor)
// ---------------------------------------------------------------------------

describe('countTokensGpt', () => {
  it('returns 0 for empty string', () => {
    expect(countTokensGpt('')).toBe(0)
  })
  it('returns the encoded token count for non-empty text', () => {
    const result = countTokensGpt('hello world')
    expect(result).toBeGreaterThan(0)
    expect(result).toBe(encode('hello world').length)
  })
})

describe('countTokensApprox', () => {
  it('returns 0 for empty string', () => {
    expect(countTokensApprox('')).toBe(0)
  })
  it('approximates chars / 3.8', () => {
    const text = 'a'.repeat(38)
    expect(countTokensApprox(text)).toBe(10)
  })
})

describe('AUTO_VERSION_CAP', () => {
  it('is 50', () => {
    expect(AUTO_VERSION_CAP).toBe(50)
  })
})

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

  it('uses AUTO_VERSION_CAP as the default cap, preserving newest-first order', () => {
    const autos = makeVersions(51, true) // v0 = newest .. v50 = oldest
    const result = pruneAutoVersions(autos)
    expect(result).toHaveLength(AUTO_VERSION_CAP)
    expect(result.map((v) => v.id)).toEqual(autos.slice(0, AUTO_VERSION_CAP).map((v) => v.id))
    // the oldest one (v50) was dropped
    expect(result.find((v) => v.id === 'v50')).toBeUndefined()
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

describe('pruneRestoreSnapshots', () => {
  function snap(id: string, overrides: Partial<{ label?: string; auto: boolean }> = {}) {
    return { id, label: RESTORE_SNAPSHOT_LABEL, auto: false, ...overrides }
  }

  it('constants', () => {
    expect(RESTORE_SNAPSHOT_CAP).toBe(5)
    expect(RESTORE_SNAPSHOT_LABEL).toBe('Before restore')
  })

  it('empty array in, empty array out', () => {
    expect(pruneRestoreSnapshots([])).toEqual([])
  })

  it('fewer snapshots than the cap are all kept', () => {
    const versions = [snap('a'), snap('b'), snap('c')]
    const result = pruneRestoreSnapshots(versions, 5)
    expect(result).toEqual(versions)
  })

  it('keeps the 5 newest snapshots, drops the 2 oldest, preserves other versions and order', () => {
    const versions = [
      snap('s1'),
      { id: 'auto1', label: undefined, auto: true },
      snap('s2'),
      snap('s3'),
      { id: 'manual1', label: undefined, auto: false },
      snap('s4'),
      { id: 'pinned1', label: 'v1', auto: false },
      snap('s5'),
      snap('s6'), // 6th snapshot — beyond cap, dropped
      snap('s7'), // 7th snapshot — beyond cap, dropped
    ]
    const result = pruneRestoreSnapshots(versions, 5)
    expect(result.map((v) => v.id)).toEqual([
      's1', 'auto1', 's2', 's3', 'manual1', 's4', 'pinned1', 's5',
    ])
    expect(result.find((v) => v.id === 's6')).toBeUndefined()
    expect(result.find((v) => v.id === 's7')).toBeUndefined()
  })

  it('a snapshot with auto:true (defensive, not reachable today) is not counted and is kept', () => {
    const versions = [
      snap('s1'),
      snap('s2'),
      snap('s3'),
      snap('s4'),
      snap('s5'),
      { id: 'weird', label: RESTORE_SNAPSHOT_LABEL, auto: true },
      snap('s6'), // 6th real snapshot — beyond cap, dropped
    ]
    const result = pruneRestoreSnapshots(versions, 5)
    expect(result.find((v) => v.id === 'weird')).toBeDefined()
    expect(result.find((v) => v.id === 's6')).toBeUndefined()
    expect(result).toHaveLength(6)
  })

  it('a renamed snapshot (label no longer matches) is never pruned', () => {
    const versions = [
      snap('s1'),
      snap('s2'),
      snap('s3'),
      snap('s4'),
      snap('s5'),
      { id: 'renamed', label: 'keep me', auto: false },
      snap('s6'), // 6th real snapshot — beyond cap, dropped
    ]
    const result = pruneRestoreSnapshots(versions, 5)
    expect(result.find((v) => v.id === 'renamed')).toBeDefined()
    expect(result.find((v) => v.id === 's6')).toBeUndefined()
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

  it('returns "N days ago" for 3 days', () => {
    const result = formatVersionTime(base, base + 3 * 86_400_000)
    expect(result).toBe('3 days ago')
  })

  it('returns "<date> at <time>" for more than 7 days ago', () => {
    const result = formatVersionTime(base, base + 10 * 86_400_000)
    expect(result).toContain(' at ')
    expect(result).not.toMatch(/ago$/)
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
// migrateLegacyStorage
// ---------------------------------------------------------------------------

/** Tiny in-memory StorageLike backed by a Map — no jsdom localStorage involved. */
function makeMemoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial))
  return {
    data,
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null
    },
    setItem(key: string, value: string) {
      data.set(key, value)
    },
    removeItem(key: string) {
      data.delete(key)
    },
  }
}

describe('migrateLegacyStorage', () => {
  it('moves the legacy value to the new key and removes the legacy key when the new key is absent', () => {
    const storage = makeMemoryStorage({ [LEGACY_STORAGE_KEY]: '{"legacy":true}' })
    const result = migrateLegacyStorage(storage)
    expect(result).toBe('migrated')
    expect(storage.getItem(STORAGE_KEY)).toBe('{"legacy":true}')
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull()
  })

  it('overwrites an existing new-key value with the legacy value (old-editor data intentionally discarded)', () => {
    const storage = makeMemoryStorage({
      [STORAGE_KEY]: '{"old":true}',
      [LEGACY_STORAGE_KEY]: '{"legacy":true}',
    })
    const result = migrateLegacyStorage(storage)
    expect(result).toBe('migrated')
    expect(storage.getItem(STORAGE_KEY)).toBe('{"legacy":true}')
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull()
  })

  it('is a no-op when the legacy key is absent', () => {
    const storage = makeMemoryStorage({ [STORAGE_KEY]: '{"current":true}' })
    const result = migrateLegacyStorage(storage)
    expect(result).toBe('noop')
    expect(storage.getItem(STORAGE_KEY)).toBe('{"current":true}')
  })

  it('returns "noop" and keeps the legacy key when setItem throws', () => {
    const storage = makeMemoryStorage({ [LEGACY_STORAGE_KEY]: '{"legacy":true}' })
    storage.setItem = () => { throw new Error('storage full') }
    const result = migrateLegacyStorage(storage)
    expect(result).toBe('noop')
    expect(storage.data.get(LEGACY_STORAGE_KEY)).toBe('{"legacy":true}')
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
