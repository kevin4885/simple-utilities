/**
 * visual-markdown-editor/store.actions.test.ts
 *
 * Live-store tests for the version-history actions (saveVersion, restoreVersion,
 * deleteVersion, pinVersion). Uses the real useVmeStore (zustand + persist);
 * state is seeded/reset via setState in beforeEach.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useVmeStore, type VmeDoc } from './store'
import { AUTO_VERSION_CAP } from './logic'

function makeDoc(overrides: Partial<VmeDoc> = {}): VmeDoc {
  return {
    id: 'd1',
    title: 'T',
    content: '',
    updatedAt: 0,
    versions: [],
    ...overrides,
  }
}

beforeEach(() => {
  useVmeStore.setState({
    docs: [makeDoc()],
    activeDocId: 'd1',
  })
})

describe('saveVersion', () => {
  it('returns null for empty content and adds nothing', () => {
    useVmeStore.setState({ docs: [makeDoc({ content: '' })], activeDocId: 'd1' })
    const id = useVmeStore.getState().saveVersion('d1')
    expect(id).toBeNull()
    expect(useVmeStore.getState().docs[0].versions).toHaveLength(0)
  })

  it('returns null for whitespace-only content and adds nothing', () => {
    useVmeStore.setState({ docs: [makeDoc({ content: '   \n  ' })], activeDocId: 'd1' })
    const id = useVmeStore.getState().saveVersion('d1')
    expect(id).toBeNull()
    expect(useVmeStore.getState().docs[0].versions).toHaveLength(0)
  })

  it('with content "hello" returns an id; version is newest-first, auto:true, no label', () => {
    useVmeStore.setState({ docs: [makeDoc({ content: 'hello' })], activeDocId: 'd1' })
    const id = useVmeStore.getState().saveVersion('d1')
    expect(id).not.toBeNull()
    const versions = useVmeStore.getState().docs[0].versions
    expect(versions[0].id).toBe(id)
    expect(versions[0].content).toBe('hello')
    expect(versions[0].auto).toBe(true)
    expect(versions[0].label).toBeUndefined()
  })

  it('saving identical content twice → second call returns null, still 1 version', () => {
    useVmeStore.setState({ docs: [makeDoc({ content: 'hello' })], activeDocId: 'd1' })
    const first = useVmeStore.getState().saveVersion('d1')
    expect(first).not.toBeNull()
    const second = useVmeStore.getState().saveVersion('d1')
    expect(second).toBeNull()
    expect(useVmeStore.getState().docs[0].versions).toHaveLength(1)
  })

  it('saveVersion(id, { auto:false }) → auto:false, no label (manual)', () => {
    useVmeStore.setState({ docs: [makeDoc({ content: 'hello' })], activeDocId: 'd1' })
    useVmeStore.getState().saveVersion('d1', { auto: false })
    const version = useVmeStore.getState().docs[0].versions[0]
    expect(version.auto).toBe(false)
    expect(version.label).toBeUndefined()
  })

  it('saveVersion(id, { label:"v1" }) → auto:false, label:"v1" even without auto option', () => {
    useVmeStore.setState({ docs: [makeDoc({ content: 'hello' })], activeDocId: 'd1' })
    useVmeStore.getState().saveVersion('d1', { label: 'v1' })
    const version = useVmeStore.getState().docs[0].versions[0]
    expect(version.auto).toBe(false)
    expect(version.label).toBe('v1')
  })

  it('prunes the oldest auto version beyond the cap, keeping pinned versions', () => {
    const autoVersions = Array.from({ length: AUTO_VERSION_CAP }, (_, i) => ({
      id: `auto-${i}`,
      content: `auto content ${i}`,
      savedAt: i,
      auto: true,
    }))
    const pinned = { id: 'pinned-1', content: 'pinned content', savedAt: -1, label: 'Milestone', auto: false }
    useVmeStore.setState({
      docs: [makeDoc({ content: 'new content', versions: [...autoVersions, pinned] })],
      activeDocId: 'd1',
    })
    useVmeStore.getState().saveVersion('d1')
    const versions = useVmeStore.getState().docs[0].versions
    expect(versions).toHaveLength(AUTO_VERSION_CAP + 1) // pinned + cap auto (oldest auto dropped)
    expect(versions.find((v) => v.id === 'pinned-1')).toBeDefined()
    const autoCount = versions.filter((v) => v.auto).length
    expect(autoCount).toBe(AUTO_VERSION_CAP)
    // the oldest auto version (auto-49, last in the array) was dropped
    expect(versions.find((v) => v.id === `auto-${AUTO_VERSION_CAP - 1}`)).toBeUndefined()
  })

  it('is a no-op for an unknown docId', () => {
    const before = useVmeStore.getState().docs
    const id = useVmeStore.getState().saveVersion('unknown-doc')
    expect(id).toBeNull()
    expect(useVmeStore.getState().docs).toEqual(before)
  })
})

describe('restoreVersion', () => {
  it('restores content and adds a pinned "Before restore" snapshot of the previous content', () => {
    const oldVersion = { id: 'v-old', content: 'old', savedAt: 1000, auto: true }
    useVmeStore.setState({
      docs: [makeDoc({ content: 'new', versions: [oldVersion] })],
      activeDocId: 'd1',
    })
    useVmeStore.getState().restoreVersion('d1', 'v-old')
    const doc = useVmeStore.getState().docs[0]
    expect(doc.content).toBe('old')
    expect(doc.versions[0]).toMatchObject({ label: 'Before restore', auto: false, content: 'new' })
  })

  it('unknown versionId → no change to content or versions length', () => {
    const oldVersion = { id: 'v-old', content: 'old', savedAt: 1000, auto: true }
    useVmeStore.setState({
      docs: [makeDoc({ content: 'new', versions: [oldVersion] })],
      activeDocId: 'd1',
    })
    useVmeStore.getState().restoreVersion('d1', 'does-not-exist')
    const doc = useVmeStore.getState().docs[0]
    expect(doc.content).toBe('new')
    expect(doc.versions).toHaveLength(1)
  })

  it('when current content equals the newest version, restoring adds no "Before restore" entry but still restores content', () => {
    const oldVersion = { id: 'v-old', content: 'old', savedAt: 1000, auto: true }
    const currentVersion = { id: 'v-current', content: 'current', savedAt: 2000, auto: true }
    useVmeStore.setState({
      docs: [makeDoc({ content: 'current', versions: [currentVersion, oldVersion] })],
      activeDocId: 'd1',
    })
    useVmeStore.getState().restoreVersion('d1', 'v-old')
    const doc = useVmeStore.getState().docs[0]
    expect(doc.content).toBe('old')
    // no new "Before restore" version was added — still just the original 2
    expect(doc.versions).toHaveLength(2)
    expect(doc.versions.find((v) => v.label === 'Before restore')).toBeUndefined()
  })

  it('is a no-op for an unknown docId', () => {
    const before = useVmeStore.getState().docs
    useVmeStore.getState().restoreVersion('unknown-doc', 'v-old')
    expect(useVmeStore.getState().docs).toEqual(before)
  })
})

describe('restoreVersion — snapshot cap', () => {
  it('caps automatic "Before restore" snapshots at 5, dropping the oldest first', () => {
    // Seed 6 distinct target versions t1..t6, current content starts at c0.
    const targets = ['t1', 't2', 't3', 't4', 't5', 't6'].map((id, i) => ({
      id,
      content: id,
      savedAt: i,
      auto: true,
    }))
    useVmeStore.setState({
      docs: [makeDoc({ content: 'c0', versions: targets })],
      activeDocId: 'd1',
    })

    // Restoring t1 snapshots 'c0'; restoring t2 snapshots 't1' (the content
    // just restored to); etc. Each restore's *current* content differs from
    // the newest version, so every restore creates a new "Before restore" snapshot.
    for (const id of ['t1', 't2', 't3', 't4', 't5', 't6']) {
      useVmeStore.getState().restoreVersion('d1', id)
    }

    const doc = useVmeStore.getState().docs[0]
    const snapshots = doc.versions.filter((v) => v.label === 'Before restore')
    expect(snapshots).toHaveLength(5)
    // The oldest snapshot (of 'c0', taken during the first restore) was pruned.
    expect(snapshots.find((v) => v.content === 'c0')).toBeUndefined()
    // The original t* target versions are untouched.
    expect(targets.every((t) => doc.versions.some((v) => v.id === t.id))).toBe(true)
    expect(doc.content).toBe('t6')
  })

  it('a renamed "Before restore" snapshot survives the cap', () => {
    const targets = ['t1', 't2', 't3', 't4', 't5', 't6'].map((id, i) => ({
      id,
      content: id,
      savedAt: i,
      auto: true,
    }))
    useVmeStore.setState({
      docs: [makeDoc({ content: 'c0', versions: targets })],
      activeDocId: 'd1',
    })

    for (const id of ['t1', 't2', 't3', 't4', 't5', 't6']) {
      useVmeStore.getState().restoreVersion('d1', id)
    }

    // Rename the oldest surviving "Before restore" snapshot (exempts it from future pruning).
    const beforeRename = useVmeStore.getState().docs[0].versions
    const oldestSnapshot = [...beforeRename].reverse().find((v) => v.label === 'Before restore')
    expect(oldestSnapshot).toBeDefined()
    useVmeStore.getState().pinVersion('d1', oldestSnapshot!.id, 'keep me')

    // One more restore — would normally push the snapshot count to 6 and prune the oldest,
    // but the renamed one no longer matches the label so it's exempt.
    useVmeStore.getState().restoreVersion('d1', 't1')

    const doc = useVmeStore.getState().docs[0]
    expect(doc.versions.find((v) => v.label === 'keep me')).toBeDefined()
    const snapshots = doc.versions.filter((v) => v.label === 'Before restore')
    // Exactly 5 "Before restore" snapshots survive: the one renamed to "keep me" is
    // exempt from the cap, so the 7th auto snapshot (from this extra restore) still
    // triggers pruning down to 5 — proving the cap logic actually ran.
    expect(snapshots).toHaveLength(5)
    // Total versions: 5 "Before restore" snapshots + 1 renamed "keep me" snapshot +
    // 6 original target versions (t1..t6, untouched) = 12. This fails if pruning is
    // removed (would be 13) or over-pruned.
    expect(doc.versions).toHaveLength(12)
  })
})

describe('deleteVersion', () => {
  it('removes only the given version id', () => {
    const v1 = { id: 'v1', content: 'a', savedAt: 1, auto: true }
    const v2 = { id: 'v2', content: 'b', savedAt: 2, auto: true }
    useVmeStore.setState({ docs: [makeDoc({ versions: [v2, v1] })], activeDocId: 'd1' })
    useVmeStore.getState().deleteVersion('d1', 'v1')
    const versions = useVmeStore.getState().docs[0].versions
    expect(versions).toHaveLength(1)
    expect(versions[0].id).toBe('v2')
  })

  it('unknown id → no change', () => {
    const v1 = { id: 'v1', content: 'a', savedAt: 1, auto: true }
    useVmeStore.setState({ docs: [makeDoc({ versions: [v1] })], activeDocId: 'd1' })
    useVmeStore.getState().deleteVersion('d1', 'does-not-exist')
    expect(useVmeStore.getState().docs[0].versions).toHaveLength(1)
  })

  it('is a no-op for an unknown docId', () => {
    const before = useVmeStore.getState().docs
    useVmeStore.getState().deleteVersion('unknown-doc', 'v1')
    expect(useVmeStore.getState().docs).toEqual(before)
  })

  it('unknown docId does not notify subscribers and keeps the same docs reference', () => {
    const v1 = { id: 'v1', content: 'a', savedAt: 1, auto: true }
    useVmeStore.setState({ docs: [makeDoc({ versions: [v1] })], activeDocId: 'd1' })
    const before = useVmeStore.getState().docs
    const spy = vi.fn()
    const unsub = useVmeStore.subscribe(spy)
    useVmeStore.getState().deleteVersion('unknown-doc', 'v1')
    expect(spy).not.toHaveBeenCalled()
    expect(useVmeStore.getState().docs).toBe(before)
    unsub()
  })

  it('unknown versionId does not notify subscribers and keeps the same docs reference', () => {
    const v1 = { id: 'v1', content: 'a', savedAt: 1, auto: true }
    useVmeStore.setState({ docs: [makeDoc({ versions: [v1] })], activeDocId: 'd1' })
    const before = useVmeStore.getState().docs
    const spy = vi.fn()
    const unsub = useVmeStore.subscribe(spy)
    useVmeStore.getState().deleteVersion('d1', 'does-not-exist')
    expect(spy).not.toHaveBeenCalled()
    expect(useVmeStore.getState().docs).toBe(before)
    unsub()
  })
})

describe('pinVersion', () => {
  it('sets auto:false and trims the label', () => {
    const v1 = { id: 'v1', content: 'a', savedAt: 1, auto: true }
    useVmeStore.setState({ docs: [makeDoc({ versions: [v1] })], activeDocId: 'd1' })
    useVmeStore.getState().pinVersion('d1', 'v1', '  My Label  ')
    const version = useVmeStore.getState().docs[0].versions[0]
    expect(version.auto).toBe(false)
    expect(version.label).toBe('My Label')
  })

  it('empty label keeps the existing label', () => {
    const v1 = { id: 'v1', content: 'a', savedAt: 1, label: 'Existing', auto: false }
    useVmeStore.setState({ docs: [makeDoc({ versions: [v1] })], activeDocId: 'd1' })
    useVmeStore.getState().pinVersion('d1', 'v1', '   ')
    const version = useVmeStore.getState().docs[0].versions[0]
    expect(version.label).toBe('Existing')
    expect(version.auto).toBe(false)
  })

  it('empty label leaves label undefined when there was none', () => {
    const v1 = { id: 'v1', content: 'a', savedAt: 1, auto: true }
    useVmeStore.setState({ docs: [makeDoc({ versions: [v1] })], activeDocId: 'd1' })
    useVmeStore.getState().pinVersion('d1', 'v1', '   ')
    const version = useVmeStore.getState().docs[0].versions[0]
    expect(version.label).toBeUndefined()
    expect(version.auto).toBe(false)
  })

  it('is a no-op for an unknown docId', () => {
    const before = useVmeStore.getState().docs
    useVmeStore.getState().pinVersion('unknown-doc', 'v1', 'x')
    expect(useVmeStore.getState().docs).toEqual(before)
  })

  it('unknown docId does not notify subscribers and keeps the same docs reference', () => {
    const v1 = { id: 'v1', content: 'a', savedAt: 1, auto: true }
    useVmeStore.setState({ docs: [makeDoc({ versions: [v1] })], activeDocId: 'd1' })
    const before = useVmeStore.getState().docs
    const spy = vi.fn()
    const unsub = useVmeStore.subscribe(spy)
    useVmeStore.getState().pinVersion('unknown-doc', 'v1', 'x')
    expect(spy).not.toHaveBeenCalled()
    expect(useVmeStore.getState().docs).toBe(before)
    unsub()
  })

  it('unknown versionId does not notify subscribers and keeps the same docs reference', () => {
    const v1 = { id: 'v1', content: 'a', savedAt: 1, auto: true }
    useVmeStore.setState({ docs: [makeDoc({ versions: [v1] })], activeDocId: 'd1' })
    const before = useVmeStore.getState().docs
    const spy = vi.fn()
    const unsub = useVmeStore.subscribe(spy)
    useVmeStore.getState().pinVersion('d1', 'does-not-exist', 'x')
    expect(spy).not.toHaveBeenCalled()
    expect(useVmeStore.getState().docs).toBe(before)
    unsub()
  })
})
