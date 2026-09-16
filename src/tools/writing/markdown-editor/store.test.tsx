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
 *
 * Signed-in (cloud-backed) coverage lives in its own `describe` block near
 * the bottom of this file (`useMarkdownEditorState — signed in`) — it mocks
 * `useAuth` + the Supabase client (mirroring `useToolState.test.tsx`'s own
 * mocking approach) and exercises `useMarkdownEditorState()` via
 * `renderHook`, per this phase's acceptance criteria.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { mergePersisted, useVmeStore, useMarkdownEditorState, type VmeDoc } from './store'
import { DEFAULT_EXPORT_OPTIONS } from './export/exportOptions'

// ---------------------------------------------------------------------------
// Mocks for the "signed in" describe block near the bottom of this file —
// declared at module scope (vi.mock calls are hoisted above all imports by
// vitest's transform regardless of where they're written) so they also
// apply to store.ts's own top-level `useAuth`/`useToolState`/
// `useToolItemList` imports used by the "signed out" tests above. The
// "signed out" tests never touch `useAuthMock`/`fromMock`, so leaving them
// unconfigured (mockReturnValue never called) is fine — `useAuth()` mocked
// to return `undefined` would break `useMarkdownEditorState`'s destructure,
// so `beforeEach` below always sets a safe default for every test in the
// file, mirroring `useToolState.test.tsx`'s own approach.
const useAuthMock = vi.fn()
vi.mock('@/lib/auth/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

const fromMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

beforeEach(() => {
  useAuthMock.mockReset().mockReturnValue({ status: 'signed-out', user: null })
  fromMock.mockReset()
})

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

// ---------------------------------------------------------------------------
// useMarkdownEditorState — signed in (cloud-backed path)
//
// A minimal in-memory fake of the `tool_state` table, keyed on
// `(user_id, tool_id, item_id)`, standing in for Postgres. Mirrors the exact
// call shapes `useToolState`/`useToolItemList`/`useDeleteToolItem` (Phase 1/
// 1b, unmodified) issue — see their own source for the shapes this mirrors:
//   - read:   .select(...).eq('user_id',u).eq('tool_id',t).eq('item_id',i).maybeSingle()
//   - upsert: .upsert({ user_id, tool_id, item_id, data })
//   - list:   .select('item_id').eq('user_id',u).eq('tool_id',t)   (awaited directly)
//   - delete: .delete().eq('user_id',u).eq('tool_id',t).eq('item_id',i)  (awaited directly)
// ---------------------------------------------------------------------------

interface FakeRow {
  user_id: string
  tool_id: string
  item_id: string
  data: unknown
}

function rowKey(userId: string, toolId: string, itemId: string) {
  return `${userId}::${toolId}::${itemId}`
}

function createFakeToolStateTable() {
  const rows = new Map<string, FakeRow>()
  const upsertCalls: FakeRow[] = []
  const deleteCalls: { user_id: string; tool_id: string; item_id: string }[] = []

  function seed(userId: string, toolId: string, itemId: string, data: unknown) {
    rows.set(rowKey(userId, toolId, itemId), { user_id: userId, tool_id: toolId, item_id: itemId, data })
  }

  const fromImpl = () => ({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    select: (_cols: string) => {
      const filters: Record<string, string> = {}
      const builder = {
        eq(col: string, val: string) {
          filters[col] = val
          return builder
        },
        async maybeSingle() {
          const row = rows.get(rowKey(filters.user_id, filters.tool_id, filters.item_id))
          return { data: row ? { data: row.data } : null, error: null }
        },
        // useToolItemList awaits the chain directly (no .maybeSingle() call)
        // after exactly two `.eq()` calls — making the builder itself
        // thenable lets `await` resolve it without a real Promise wrapper.
        then(resolve: (v: { data: { item_id: string }[]; error: null }) => void) {
          const matched = [...rows.values()].filter(
            (r) => r.user_id === filters.user_id && r.tool_id === filters.tool_id,
          )
          resolve({ data: matched.map((r) => ({ item_id: r.item_id })), error: null })
        },
      }
      return builder
    },
    upsert: (row: FakeRow) => {
      upsertCalls.push(row)
      rows.set(rowKey(row.user_id, row.tool_id, row.item_id), row)
      return Promise.resolve({ data: null, error: null })
    },
    delete: () => {
      const filters: Record<string, string> = {}
      const builder = {
        eq(col: string, val: string) {
          filters[col] = val
          if (filters.user_id && filters.tool_id && filters.item_id) {
            deleteCalls.push({ user_id: filters.user_id, tool_id: filters.tool_id, item_id: filters.item_id })
            rows.delete(rowKey(filters.user_id, filters.tool_id, filters.item_id))
            return Promise.resolve({ data: null, error: null })
          }
          return builder
        },
      }
      return builder
    },
  })

  return { rows, upsertCalls, deleteCalls, seed, fromImpl }
}

const USER_ID = 'the-current-user'
const TOOL_ID = 'markdown-editor'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useMarkdownEditorState — signed in', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ status: 'signed-in', user: { id: USER_ID } })
  })

  it('creating a document writes one new row with a fresh item_id', async () => {
    const table = createFakeToolStateTable()
    const existingDoc = { id: 'doc-existing', title: 'Untitled 1', content: '', updatedAt: 1000, versions: [] }
    table.seed(USER_ID, TOOL_ID, '_settings', {
      activeDocId: 'doc-existing',
      selectedModel: 'gpt4o',
      docsIndex: [{ id: 'doc-existing', title: 'Untitled 1', updatedAt: 1000 }],
    })
    table.seed(USER_ID, TOOL_ID, 'doc-existing', existingDoc)
    fromMock.mockImplementation(table.fromImpl)

    const { result } = renderHook(() => useMarkdownEditorState(), { wrapper })

    await waitFor(() => expect(result.current.docs.map((d) => d.id)).toEqual(['doc-existing']))

    act(() => {
      result.current.createDoc()
    })

    // Settings row's docsIndex grows to 2 docs.
    await waitFor(() => expect(result.current.docs).toHaveLength(2))
    const newDocId = result.current.docs.find((d) => d.id !== 'doc-existing')!.id
    expect(newDocId).not.toBe('doc-existing')

    // The new doc's own row was written via upsert, scoped to this user/tool
    // and the fresh item_id — never the existing doc's id.
    await waitFor(() =>
      expect(table.upsertCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ user_id: USER_ID, tool_id: TOOL_ID, item_id: newDocId }),
        ]),
      ),
    )
    expect(table.rows.has(rowKey(USER_ID, TOOL_ID, newDocId))).toBe(true)
  })

  it('deleting a document removes exactly that row', async () => {
    const table = createFakeToolStateTable()
    table.seed(USER_ID, TOOL_ID, '_settings', {
      activeDocId: 'doc-a',
      selectedModel: 'gpt4o',
      docsIndex: [
        { id: 'doc-a', title: 'Doc A', updatedAt: 1000 },
        { id: 'doc-b', title: 'Doc B', updatedAt: 2000 },
      ],
    })
    table.seed(USER_ID, TOOL_ID, 'doc-a', { id: 'doc-a', title: 'Doc A', content: 'a', updatedAt: 1000, versions: [] })
    table.seed(USER_ID, TOOL_ID, 'doc-b', { id: 'doc-b', title: 'Doc B', content: 'b', updatedAt: 2000, versions: [] })
    fromMock.mockImplementation(table.fromImpl)

    const { result } = renderHook(() => useMarkdownEditorState(), { wrapper })
    await waitFor(() => expect(result.current.docs.map((d) => d.id).sort()).toEqual(['doc-a', 'doc-b']))

    act(() => {
      result.current.deleteDoc('doc-b')
    })

    await waitFor(() => expect(table.rows.has(rowKey(USER_ID, TOOL_ID, 'doc-b'))).toBe(false))
    // Only doc-b's row was removed — doc-a's row and the settings row remain.
    expect(table.rows.has(rowKey(USER_ID, TOOL_ID, 'doc-a'))).toBe(true)
    expect(table.rows.has(rowKey(USER_ID, TOOL_ID, '_settings'))).toBe(true)
    expect(table.deleteCalls).toEqual([{ user_id: USER_ID, tool_id: TOOL_ID, item_id: 'doc-b' }])
  })

  it("updating a document's content upserts that document's row only, not the settings row or any other document's row", async () => {
    const table = createFakeToolStateTable()
    table.seed(USER_ID, TOOL_ID, '_settings', {
      activeDocId: 'doc-a',
      selectedModel: 'gpt4o',
      docsIndex: [
        { id: 'doc-a', title: 'Doc A', updatedAt: 1000 },
        { id: 'doc-b', title: 'Doc B', updatedAt: 2000 },
      ],
    })
    table.seed(USER_ID, TOOL_ID, 'doc-a', { id: 'doc-a', title: 'Doc A', content: 'old', updatedAt: 1000, versions: [] })
    table.seed(USER_ID, TOOL_ID, 'doc-b', { id: 'doc-b', title: 'Doc B', content: 'b', updatedAt: 2000, versions: [] })
    fromMock.mockImplementation(table.fromImpl)

    const { result } = renderHook(() => useMarkdownEditorState(), { wrapper })
    await waitFor(() => expect(result.current.docs.map((d) => d.id).sort()).toEqual(['doc-a', 'doc-b']))

    table.upsertCalls.length = 0 // clear any bootstrap/settle upserts before the action under test

    act(() => {
      result.current.updateDoc('doc-a', { content: 'new content' })
    })

    await waitFor(() =>
      expect(table.upsertCalls).toEqual([
        expect.objectContaining({ user_id: USER_ID, tool_id: TOOL_ID, item_id: 'doc-a' }),
      ]),
    )
    // Neither the settings row nor doc-b's row was touched.
    expect(table.upsertCalls.some((c) => c.item_id === '_settings')).toBe(false)
    expect(table.upsertCalls.some((c) => c.item_id === 'doc-b')).toBe(false)
  })

  it.each([
    ['setModel', (r: ReturnType<typeof useMarkdownEditorState>) => r.setModel('claude')],
    ['setEditorMode', (r: ReturnType<typeof useMarkdownEditorState>) => r.setEditorMode('markdown')],
    ['dismissHint', (r: ReturnType<typeof useMarkdownEditorState>) => r.dismissHint()],
    ['setExportPrefs', (r: ReturnType<typeof useMarkdownEditorState>) => r.setExportPrefs({ paper: 'a4' })],
  ])('%s writes to the \'_settings\' row only', async (_name, act_) => {
    const table = createFakeToolStateTable()
    table.seed(USER_ID, TOOL_ID, '_settings', {
      activeDocId: 'doc-a',
      selectedModel: 'gpt4o',
      docsIndex: [{ id: 'doc-a', title: 'Doc A', updatedAt: 1000 }],
    })
    table.seed(USER_ID, TOOL_ID, 'doc-a', { id: 'doc-a', title: 'Doc A', content: 'a', updatedAt: 1000, versions: [] })
    fromMock.mockImplementation(table.fromImpl)

    const { result } = renderHook(() => useMarkdownEditorState(), { wrapper })
    await waitFor(() => expect(result.current.docs.map((d) => d.id)).toEqual(['doc-a']))

    table.upsertCalls.length = 0

    act(() => {
      act_(result.current)
    })

    await waitFor(() => expect(table.upsertCalls.length).toBeGreaterThan(0))
    expect(table.upsertCalls.every((c) => c.item_id === '_settings')).toBe(true)
  })

  it('a brand-new signed-in account with zero cloud rows bootstraps exactly one starter document', async () => {
    const table = createFakeToolStateTable()
    fromMock.mockImplementation(table.fromImpl)

    const { result } = renderHook(() => useMarkdownEditorState(), { wrapper })

    await waitFor(() => expect(result.current.docs).toHaveLength(1))
    await waitFor(() => expect(result.current.docs[0].title).toBe('Untitled 1'))
    expect(table.rows.has(rowKey(USER_ID, TOOL_ID, '_settings'))).toBe(true)
  })
})

describe('useMarkdownEditorState — signed out (unaffected by the cloud path existing)', () => {
  it('still returns the local Zustand store\'s state and never calls the Supabase client', () => {
    useAuthMock.mockReturnValue({ status: 'signed-out', user: null })
    useVmeStore.setState({
      docs: [{ id: 'local-doc', title: 'Local', content: 'hi', updatedAt: 1, versions: [] }],
      activeDocId: 'local-doc',
    })

    const { result } = renderHook(() => useMarkdownEditorState(), { wrapper })

    expect(result.current.docs[0].id).toBe('local-doc')
    expect(fromMock).not.toHaveBeenCalled()
  })
})
