/**
 * markdown-editor/store.test.ts
 *
 * Tests for the VME Zustand store's merge/rehydration behaviour, using the
 * real `mergePersisted` exported from store.ts (not a re-implementation —
 * see Phase 02 Conventions: exporting the merge helper avoids duplicating
 * the merge logic in the test file).
 *
 * Covers:
 *   (a) Legacy persisted state without editorMode/hintDismissed/exportPrefs
 *       → defaults ('wysiwyg' / false / DEFAULT_EXPORT_OPTIONS).
 *   (b) Invalid editorMode value (e.g. 'bogus') → rejected/defaulted, no crash.
 *   (c) 'split' persists correctly and merges back.
 *   (d) Existing docs/content survive the merge unchanged.
 *   (e) exportPrefs: absent → defaults; partial → merged over defaults;
 *       invalid → per-field fallback (via resolveExportOptions).
 */

import { describe, it, expect } from 'vitest'
import { mergePersisted, useVmeStore, type VmeDoc } from './store'
import { DEFAULT_EXPORT_OPTIONS } from './export/exportOptions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefaultDoc(): VmeDoc {
  return {
    id: 'default-id',
    title: 'Untitled 1',
    content: '',
    updatedAt: Date.now(),
    versions: [],
  }
}

function makeCurrent(overrides: Partial<ReturnType<typeof useVmeStore.getState>> = {}) {
  const doc = makeDefaultDoc()
  return {
    ...useVmeStore.getState(),
    docs: [doc],
    activeDocId: doc.id,
    selectedModel: 'gpt4o' as const,
    editorMode: 'wysiwyg' as const,
    hintDismissed: false,
    exportPrefs: DEFAULT_EXPORT_OPTIONS,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VME store merge — legacy state without editorMode/hintDismissed', () => {
  it('(a) loads with default editorMode=wysiwyg when field is absent', () => {
    const doc = { id: 'doc1', title: 'My Doc', content: '# Hello', updatedAt: 1000, versions: [] }
    const legacy = {
      docs: [doc],
      activeDocId: 'doc1',
      selectedModel: 'gpt4o',
      // no editorMode, no hintDismissed, no exportPrefs
    }
    const current = makeCurrent()
    const merged = mergePersisted(legacy, current)
    expect(merged.editorMode).toBe('wysiwyg')
    expect(merged.hintDismissed).toBe(false)
  })

  it('(a) loads with default hintDismissed=false when field is absent', () => {
    const doc = { id: 'doc1', title: 'My Doc', content: '', updatedAt: 1000, versions: [] }
    const legacy = { docs: [doc], activeDocId: 'doc1', selectedModel: 'claude' }
    const current = makeCurrent()
    const merged = mergePersisted(legacy, current)
    expect(merged.hintDismissed).toBe(false)
  })

  it('(a)/(e) loads with DEFAULT_EXPORT_OPTIONS when exportPrefs is absent', () => {
    const doc = { id: 'doc1', title: 'My Doc', content: '', updatedAt: 1000, versions: [] }
    const legacy = { docs: [doc], activeDocId: 'doc1', selectedModel: 'gpt4o' }
    const merged = mergePersisted(legacy, makeCurrent())
    expect(merged.exportPrefs).toEqual(DEFAULT_EXPORT_OPTIONS)
  })
})

describe('VME store merge — invalid editorMode value', () => {
  it('(b) invalid editorMode "bogus" is rejected — safeParse fails, returns current', () => {
    const doc = { id: 'doc1', title: 'My Doc', content: '# Hi', updatedAt: 1000, versions: [] }
    const bad = {
      docs: [doc],
      activeDocId: 'doc1',
      selectedModel: 'gpt4o',
      editorMode: 'bogus', // invalid
    }
    const current = makeCurrent({ editorMode: 'markdown' })
    // Zod rejects this via EditorModeSchema; safeParse fails; merge returns current unchanged
    const merged = mergePersisted(bad, current)
    // current is returned unchanged
    expect(merged).toBe(current)
    expect(merged.editorMode).toBe('markdown')
  })

  it('(b) invalid editorMode does not crash the app', () => {
    const doc = { id: 'd1', title: 'T', content: '', updatedAt: 0, versions: [] }
    expect(() => mergePersisted({ docs: [doc], activeDocId: 'd1', selectedModel: 'gpt4o', editorMode: 123 }, makeCurrent())).not.toThrow()
  })
})

describe('VME store merge — "split" mode persists and reloads', () => {
  it('(c) editorMode split is accepted and reloaded', () => {
    const doc = { id: 'doc1', title: 'My Doc', content: '# Split', updatedAt: 2000, versions: [] }
    const persisted = {
      docs: [doc],
      activeDocId: 'doc1',
      selectedModel: 'gemini',
      editorMode: 'split',
      hintDismissed: true,
    }
    const current = makeCurrent()
    const merged = mergePersisted(persisted, current)
    expect(merged.editorMode).toBe('split')
    expect(merged.hintDismissed).toBe(true)
    expect(merged.selectedModel).toBe('gemini')
  })
})

describe('VME store merge — docs/content survive', () => {
  it('(d) existing docs with content are preserved through the merge', () => {
    const docA = { id: 'a', title: 'Alpha', content: '# Alpha\n\nContent here.', updatedAt: 5000, versions: [] }
    const docB = { id: 'b', title: 'Beta',  content: '## Beta\n\nMore content.', updatedAt: 6000, versions: [] }
    const persisted = {
      docs: [docA, docB],
      activeDocId: 'b',
      selectedModel: 'claude',
      editorMode: 'markdown',
      hintDismissed: false,
    }
    const current = makeCurrent()
    const merged = mergePersisted(persisted, current)
    expect(merged.docs).toHaveLength(2)
    expect(merged.docs[0].id).toBe('a')
    expect(merged.docs[0].content).toBe('# Alpha\n\nContent here.')
    expect(merged.docs[1].content).toBe('## Beta\n\nMore content.')
    expect(merged.activeDocId).toBe('b')
  })

  it('(d) versions on docs survive the merge', () => {
    const version = { id: 'v1', content: 'old content', savedAt: 1000, auto: true }
    const doc = { id: 'doc1', title: 'Doc', content: 'new content', updatedAt: 2000, versions: [version] }
    const persisted = { docs: [doc], activeDocId: 'doc1', selectedModel: 'gpt4o', editorMode: 'wysiwyg' }
    const merged = mergePersisted(persisted, makeCurrent())
    expect(merged.docs[0].versions).toHaveLength(1)
    expect(merged.docs[0].versions[0].id).toBe('v1')
  })

  it('(d) activeDocId falls back to docs[0].id when saved id is not in docs', () => {
    const doc = { id: 'real-id', title: 'Real', content: '', updatedAt: 0, versions: [] }
    const persisted = { docs: [doc], activeDocId: 'stale-id', selectedModel: 'gpt4o', editorMode: 'wysiwyg' }
    const merged = mergePersisted(persisted, makeCurrent())
    expect(merged.activeDocId).toBe('real-id')
  })
})

describe('VME store merge — completely invalid input', () => {
  it('null persisted returns current unchanged', () => {
    const current = makeCurrent()
    expect(mergePersisted(null, current)).toBe(current)
  })

  it('empty object returns current unchanged (no docs)', () => {
    const current = makeCurrent()
    expect(mergePersisted({}, current)).toBe(current)
  })

  it('docs array empty returns current unchanged', () => {
    const current = makeCurrent()
    expect(mergePersisted({ docs: [], activeDocId: 'x', selectedModel: 'gpt4o' }, current)).toBe(current)
  })
})

describe('VME store merge — exportPrefs', () => {
  const doc = { id: 'doc1', title: 'Doc', content: '', updatedAt: 0, versions: [] }

  it('(e) partial exportPrefs merges over defaults', () => {
    const persisted = {
      docs: [doc],
      activeDocId: 'doc1',
      selectedModel: 'gpt4o',
      exportPrefs: { paper: 'a4' },
    }
    const merged = mergePersisted(persisted, makeCurrent())
    expect(merged.exportPrefs).toEqual({ ...DEFAULT_EXPORT_OPTIONS, paper: 'a4' })
  })

  it('(e) a docs load and exportPrefs with an invalid field falls back per-field, valid siblings kept', () => {
    const persisted = {
      docs: [doc],
      activeDocId: 'doc1',
      selectedModel: 'gpt4o',
      exportPrefs: { preset: 'bogus', paper: 'a4' },
    }
    const current = makeCurrent()
    const merged = mergePersisted(persisted, current)
    // docs are NOT lost/overwritten with the fresh fallback state
    expect(merged.docs).toEqual([doc])
    expect(merged.activeDocId).toBe('doc1')
    expect(merged.exportPrefs.preset).toBe(DEFAULT_EXPORT_OPTIONS.preset)
    expect(merged.exportPrefs.paper).toBe('a4')
  })

  it('(e) a wholly garbage exportPrefs value (string) still loads docs, falls back to defaults', () => {
    const persisted = {
      docs: [doc],
      activeDocId: 'doc1',
      selectedModel: 'gpt4o',
      exportPrefs: 'garbage-string',
    }
    const merged = mergePersisted(persisted, makeCurrent())
    expect(merged.docs).toEqual([doc])
    expect(merged.exportPrefs).toEqual(DEFAULT_EXPORT_OPTIONS)
  })

  it('(e) a wholly garbage exportPrefs value (number) still loads docs, falls back to defaults', () => {
    const persisted = {
      docs: [doc],
      activeDocId: 'doc1',
      selectedModel: 'gpt4o',
      exportPrefs: 42,
    }
    const merged = mergePersisted(persisted, makeCurrent())
    expect(merged.docs).toEqual([doc])
    expect(merged.exportPrefs).toEqual(DEFAULT_EXPORT_OPTIONS)
  })

  it('(e) full valid exportPrefs is preserved as-is', () => {
    const prefs = { preset: 'github', paper: 'a4', margins: 'narrow', titleBlock: true, showLinkUrls: false, pageBreakH1: true }
    const persisted = { docs: [doc], activeDocId: 'doc1', selectedModel: 'gpt4o', exportPrefs: prefs }
    const merged = mergePersisted(persisted, makeCurrent())
    expect(merged.exportPrefs).toEqual(prefs)
  })
})

describe('VME store — setExportPrefs action', () => {
  it('changes only the given field, leaving siblings untouched', () => {
    useVmeStore.setState({ exportPrefs: DEFAULT_EXPORT_OPTIONS })
    useVmeStore.getState().setExportPrefs({ paper: 'a4' })
    const prefs = useVmeStore.getState().exportPrefs
    expect(prefs.paper).toBe('a4')
    expect(prefs.preset).toBe(DEFAULT_EXPORT_OPTIONS.preset)
    expect(prefs.margins).toBe(DEFAULT_EXPORT_OPTIONS.margins)
  })

  it('can patch multiple fields at once', () => {
    useVmeStore.setState({ exportPrefs: DEFAULT_EXPORT_OPTIONS })
    useVmeStore.getState().setExportPrefs({ titleBlock: true, pageBreakH1: true })
    const prefs = useVmeStore.getState().exportPrefs
    expect(prefs.titleBlock).toBe(true)
    expect(prefs.pageBreakH1).toBe(true)
    expect(prefs.showLinkUrls).toBe(DEFAULT_EXPORT_OPTIONS.showLinkUrls)
  })

  it('an invalid patch value (e.g. ToggleGroup deselect emitting "") leaves the field unchanged', () => {
    useVmeStore.setState({ exportPrefs: DEFAULT_EXPORT_OPTIONS })
    useVmeStore.getState().setExportPrefs({ preset: '' as never })
    const prefs = useVmeStore.getState().exportPrefs
    expect(prefs.preset).toBe(DEFAULT_EXPORT_OPTIONS.preset)
  })
})
