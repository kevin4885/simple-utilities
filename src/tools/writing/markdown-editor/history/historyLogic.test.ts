import { describe, it, expect } from 'vitest'
import {
  getVersionKind,
  VERSION_KIND_LABEL,
  summarizeVersions,
  versionTitle,
  computeVersionDiff,
  isIdentical,
  formatDiffStats,
} from './historyLogic'
import type { VmeVersion } from '../store'
import { formatVersionTime } from '../logic'

function makeVersion(overrides: Partial<VmeVersion> = {}): VmeVersion {
  return {
    id: 'v1',
    content: 'hello',
    savedAt: Date.now(),
    auto: true,
    ...overrides,
  }
}

describe('getVersionKind', () => {
  it('label + auto:false → pinned', () => {
    expect(getVersionKind(makeVersion({ label: 'v1', auto: false }))).toBe('pinned')
  })
  it('label + auto:true (legacy data) → pinned', () => {
    expect(getVersionKind(makeVersion({ label: 'v1', auto: true }))).toBe('pinned')
  })
  it('no label, auto:false → manual', () => {
    expect(getVersionKind(makeVersion({ auto: false }))).toBe('manual')
  })
  it('no label, auto:true → auto', () => {
    expect(getVersionKind(makeVersion({ auto: true }))).toBe('auto')
  })
})

describe('VERSION_KIND_LABEL', () => {
  it('has the three keys with the correct display strings', () => {
    expect(VERSION_KIND_LABEL).toEqual({
      pinned: 'Pinned',
      manual: 'Manual',
      auto: 'Auto',
    })
  })
})

describe('summarizeVersions', () => {
  it('returns all zeros for an empty array', () => {
    expect(summarizeVersions([])).toEqual({ pinned: 0, manual: 0, auto: 0, total: 0 })
  })
  it('counts a mixed array correctly', () => {
    const versions: VmeVersion[] = [
      makeVersion({ id: 'a', label: 'x', auto: false }),
      makeVersion({ id: 'b', auto: false }),
      makeVersion({ id: 'c', auto: true }),
      makeVersion({ id: 'd', auto: true }),
      makeVersion({ id: 'e', auto: true }),
    ]
    const summary = summarizeVersions(versions)
    expect(summary).toEqual({ pinned: 1, manual: 1, auto: 3, total: 5 })
  })
})

describe('versionTitle', () => {
  it('returns the label when present', () => {
    expect(versionTitle(makeVersion({ label: 'Milestone' }))).toBe('Milestone')
  })
  it('returns formatVersionTime(savedAt, now) when no label', () => {
    const now = Date.now()
    const v = makeVersion({ savedAt: now - 30_000 })
    expect(versionTitle(v, now)).toBe('Just now')
  })
  it('returns formatVersionTime(savedAt, now) when label is an empty string', () => {
    const now = Date.now()
    const v = makeVersion({ label: '', savedAt: now - 30_000 })
    expect(versionTitle(v, now)).toBe('Just now')
  })
})

describe('versionTitle / getVersionKind consistency on empty label', () => {
  it('label: "" is treated as unlabeled by both versionTitle and getVersionKind', () => {
    const now = Date.now()
    const v = makeVersion({ label: '', auto: true, savedAt: now - 30_000 })
    expect(getVersionKind(v)).toBe('auto')
    expect(versionTitle(v, now)).toBe(formatVersionTime(v.savedAt, now))
  })
})

describe('computeVersionDiff', () => {
  it('identical strings → ok, stats 0/0, isIdentical true', () => {
    const result = computeVersionDiff('a\nb', 'a\nb')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.stats).toEqual({ additions: 0, deletions: 0 })
    expect(isIdentical(result)).toBe(true)
  })

  it("'a\\nb' vs 'a\\nc' → additions 1, deletions 1", () => {
    const result = computeVersionDiff('a\nb', 'a\nc')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.stats).toEqual({ additions: 1, deletions: 1 })
    expect(isIdentical(result)).toBe(false)
  })

  it('direction check: version a vs current a\\nb → additions 1, deletions 0 (added since)', () => {
    const result = computeVersionDiff('a', 'a\nb')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.stats).toEqual({ additions: 1, deletions: 0 })
  })

  it('empty version vs non-empty current → additions = line count, deletions 0', () => {
    const result = computeVersionDiff('', 'a\nb\nc')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.stats).toEqual({ additions: 3, deletions: 0 })
  })

  it('> 20 000 lines → ok:false with an error string', () => {
    const huge = Array.from({ length: 20_001 }, (_, i) => `line ${i}`).join('\n')
    const result = computeVersionDiff(huge, 'a')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(typeof result.error).toBe('string')
  })
})

describe('formatDiffStats', () => {
  it('formats using U+2212 MINUS SIGN', () => {
    expect(formatDiffStats({ additions: 3, deletions: 1 })).toBe('+3 \u22121')
  })
})
