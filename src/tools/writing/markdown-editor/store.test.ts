/**
 * visual-markdown-editor/store.test.ts
 *
 * Tests for the VME Zustand store's merge/rehydration behaviour.
 *
 * Covers:
 *   (a) Legacy persisted state without editorMode/hintDismissed → defaults
 *       to 'wysiwyg' / false (backward compatibility).
 *   (b) Invalid editorMode value (e.g. 'bogus') → rejected/defaulted, no crash.
 *   (c) 'split' persists correctly and merges back.
 *   (d) Existing docs/content survive the merge unchanged.
 *
 * Note: we test the merge function in isolation (extracted from the persist
 * config) rather than the live store to avoid localStorage side-effects and
 * zustand init ordering. We replicate the merge logic from store.ts directly.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Re-implement the merge/parse logic from store.ts so we can test it purely.
// This is the exact logic used by the 'merge' option in the persist config.
// ---------------------------------------------------------------------------

const VersionSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
  savedAt: z.number(),
  label: z.string().optional(),
  auto: z.boolean(),
})

const DocSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  updatedAt: z.number(),
  versions: z.array(VersionSchema).default([]),
})

const ModelSchema = z.enum(['gpt4o', 'claude', 'gemini'])
const EditorModeSchema = z.enum(['wysiwyg', 'markdown', 'preview', 'split'])

const PersistedSchema = z.object({
  docs: z.array(DocSchema).min(1),
  activeDocId: z.string().min(1),
  selectedModel: ModelSchema,
  editorMode: EditorModeSchema.optional(),
  hintDismissed: z.boolean().optional(),
})

type VmeEditorMode = 'wysiwyg' | 'markdown' | 'preview' | 'split'

interface MergedState {
  docs: z.infer<typeof DocSchema>[]
  activeDocId: string
  selectedModel: z.infer<typeof ModelSchema>
  editorMode: VmeEditorMode
  hintDismissed: boolean
}

function makeDefaultDoc() {
  return {
    id: 'default-id',
    title: 'Untitled 1',
    content: '',
    updatedAt: Date.now(),
    versions: [],
  }
}

function makeCurrent(overrides: Partial<MergedState> = {}): MergedState {
  const doc = makeDefaultDoc()
  return {
    docs: [doc],
    activeDocId: doc.id,
    selectedModel: 'gpt4o',
    editorMode: 'wysiwyg',
    hintDismissed: false,
    ...overrides,
  }
}

/** Replicate the merge() function from store.ts */
function mergePersisted(persisted: unknown, current: MergedState): MergedState {
  const result = PersistedSchema.safeParse(persisted)
  if (!result.success) return current
  const { docs, activeDocId, selectedModel, editorMode, hintDismissed } = result.data
  const validId = docs.find((d) => d.id === activeDocId) ? activeDocId : docs[0].id
  return {
    ...current,
    docs,
    activeDocId: validId,
    selectedModel,
    editorMode: editorMode ?? 'wysiwyg',
    hintDismissed: hintDismissed ?? false,
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
      // no editorMode, no hintDismissed
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
