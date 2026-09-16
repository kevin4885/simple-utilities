/**
 * Markdown Editor — Zustand store (persisted to localStorage under
 * `su:markdown-editor`, see STORAGE_KEY in ./logic).
 *
 * Before the persist middleware is created, `migrateLegacyStorage` runs once
 * to move any data left under the old `su:visual-markdown-editor` key (used
 * by this tool when it was still named "Visual Markdown Editor") to the new
 * key, discarding whatever the old CodeMirror-only "Markdown Editor" tool had
 * stored there.
 *
 * Cloud state (Phase 2 of google-auth-cloud-state): `useMarkdownEditorState()`
 * (bottom of this file) is what `index.tsx` actually consumes. It switches
 * between this file's local `useVmeStore` (signed out — unchanged, still the
 * exact same localStorage key/shape/`mergePersisted` behavior) and a
 * cloud-backed implementation (signed in — one `useToolState` row per
 * document, `item_id = doc.id`, plus one `'_settings'` row for
 * activeDocId/selectedModel/editorMode/hintDismissed/exportPrefs, enumerated
 * via `useToolItemList('markdown-editor')`), per
 * `swe/google-auth-cloud-state/phases/p2-markdown-editor-pilot.md`. Both
 * paths return the exact same shape (`MarkdownEditorState`) so `index.tsx`'s
 * call sites are unaffected by which path is active, and switching between
 * them at runtime (sign in/out) never crashes and never reads the other
 * path's data — the two are simply separate stores.
 */
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import {
  generateDocTitle,
  pruneAutoVersions,
  AUTO_VERSION_CAP,
  EDITOR_MODE_IDS,
  pruneRestoreSnapshots,
  RESTORE_SNAPSHOT_LABEL,
  STORAGE_KEY,
  migrateLegacyStorage,
} from './logic'
import {
  DEFAULT_EXPORT_OPTIONS,
  resolveExportOptions,
  type ExportOptions,
} from './export/exportOptions'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState, useDeleteToolItem } from '@/lib/cloudState/useToolState'
import { useToolItemList } from '@/lib/cloudState/useToolItemList'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

// ---------------------------------------------------------------------------
// Schema (Zod — validates on rehydrate)
// ---------------------------------------------------------------------------

const VersionSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
  savedAt: z.number(),
  label: z.string().optional(),
  /** true = auto-captured, false = manually pinned (never auto-purged). */
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

/** Phase 4: added editorMode and hintDismissed to persisted state. */
const EditorModeSchema = z.enum(EDITOR_MODE_IDS)

const PersistedSchema = z.object({
  docs: z.array(DocSchema).min(1),
  activeDocId: z.string().min(1),
  selectedModel: ModelSchema,
  /** Persisted editor mode (Phase 4). Defaults to 'wysiwyg' on old state. */
  editorMode: EditorModeSchema.optional(),
  /** Whether the empty-doc first-run hint has been dismissed (Phase 4). */
  hintDismissed: z.boolean().optional(),
  /** Export styling preferences (Phase 02). Validated per-field via `resolveExportOptions`
   *  in `mergePersisted` — never schema-validated here, so one invalid/legacy field can
   *  never fail the whole `PersistedSchema` parse and wipe docs/version history. */
  exportPrefs: z.unknown().optional(),
})

export type VmeVersion = z.infer<typeof VersionSchema>
export type VmeDoc    = z.infer<typeof DocSchema>
export type VmeModel  = z.infer<typeof ModelSchema>
export type VmeEditorMode = z.infer<typeof EditorModeSchema>

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface VmeState {
  docs: VmeDoc[]
  activeDocId: string
  selectedModel: VmeModel
  /** Persisted editor mode. Default 'wysiwyg'. */
  editorMode: VmeEditorMode
  /** Whether the first-run hint has been dismissed. */
  hintDismissed: boolean
  /** Export styling preferences (preset/paper/margins/title block/link URLs/page-break-per-H1). */
  exportPrefs: ExportOptions

  createDoc:   () => void
  deleteDoc:   (id: string) => void
  updateDoc:   (id: string, patch: Partial<Pick<VmeDoc, 'title' | 'content'>>) => void
  setActiveDoc:(id: string) => void
  setModel:    (m: VmeModel) => void
  setEditorMode: (mode: VmeEditorMode) => void
  dismissHint:   () => void
  /** Shallow-merge a patch into `exportPrefs` (e.g. `setExportPrefs({ paper: 'a4' })`). */
  setExportPrefs: (patch: Partial<ExportOptions>) => void

  /**
   * Capture the current content of `docId` as a new version entry.
   * Auto-versions beyond AUTO_VERSION_CAP are pruned (oldest first).
   * Supply `label` to create a pinned (non-auto) version.
   * Returns the new version's id, or null if content is empty or identical
   * to the most recent version (skip duplicate snapshots).
   */
  saveVersion:    (docId: string, opts?: { label?: string; auto?: boolean }) => string | null
  /**
   * Restore a document's content to a previous version.
   * Snapshots the current content first (label "Before restore", auto:false)
   * so the user can undo, then applies the target version's content.
   * Automatic "Before restore" snapshots are capped (see pruneRestoreSnapshots)
   * — the oldest ones beyond the cap are dropped in the same update. A
   * snapshot the user has renamed no longer matches the cap's label check,
   * so renaming a "Before restore" entry is how a user pins it forever.
   */
  restoreVersion: (docId: string, versionId: string) => void
  deleteVersion:  (docId: string, versionId: string) => void
  pinVersion:     (docId: string, versionId: string, label: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(title: string): VmeDoc {
  return {
    id: crypto.randomUUID(),
    title,
    content: '',
    updatedAt: Date.now(),
    versions: [],
  }
}

function fallbackState(): Pick<VmeState, 'docs' | 'activeDocId' | 'selectedModel' | 'editorMode' | 'hintDismissed' | 'exportPrefs'> {
  const doc = makeDoc('Untitled 1')
  return {
    docs: [doc],
    activeDocId: doc.id,
    selectedModel: 'gpt4o',
    editorMode: 'wysiwyg',
    hintDismissed: false,
    exportPrefs: DEFAULT_EXPORT_OPTIONS,
  }
}

// ---------------------------------------------------------------------------
// Legacy storage migration — must run before the persist middleware reads
// storage, so it stays at module top-level, guarded for SSR/test environments
// that lack `window`/`localStorage`.
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined' && window.localStorage) migrateLegacyStorage(window.localStorage)

// ---------------------------------------------------------------------------
// Persisted-state merge (pure — exported for direct unit testing without
// touching localStorage or zustand init ordering; see store.test.ts).
// ---------------------------------------------------------------------------

export function mergePersisted(persisted: unknown, current: VmeState): VmeState {
  const result = PersistedSchema.safeParse(persisted)
  if (!result.success) return current
  const { docs, activeDocId, selectedModel, editorMode, hintDismissed, exportPrefs } = result.data
  const validId = docs.find((d) => d.id === activeDocId) ? activeDocId : docs[0].id
  return {
    ...current,
    docs,
    activeDocId: validId,
    selectedModel,
    // Phase 4 fields: fall back to defaults if missing from old persisted state
    editorMode: editorMode ?? 'wysiwyg',
    hintDismissed: hintDismissed ?? false,
    // exportPrefs is intentionally NOT part of PersistedSchema's validated shape —
    // resolveExportOptions is per-field tolerant, so one bad/legacy field (or a
    // wholly garbage value) falls back to its default without ever failing the
    // outer safeParse and losing docs/version history.
    exportPrefs: resolveExportOptions(exportPrefs),
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useVmeStore = create<VmeState>()(
  persist(
    (set, get) => ({
      ...fallbackState(),

      createDoc() {
        const { docs } = get()
        const title = generateDocTitle(docs.map((d) => d.title))
        const doc = makeDoc(title)
        set({ docs: [...docs, doc], activeDocId: doc.id })
      },

      deleteDoc(id: string) {
        const { docs, activeDocId } = get()
        if (docs.length <= 1) return // never delete last doc
        const next = docs.filter((d) => d.id !== id)
        const newActive = activeDocId === id ? next[0].id : activeDocId
        set({ docs: next, activeDocId: newActive })
      },

      updateDoc(id: string, patch: Partial<Pick<VmeDoc, 'title' | 'content'>>) {
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d,
          ),
        }))
      },

      setActiveDoc(id: string) {
        set({ activeDocId: id })
      },

      setModel(m: VmeModel) {
        set({ selectedModel: m })
      },

      setEditorMode(mode: VmeEditorMode) {
        set({ editorMode: mode })
      },

      dismissHint() {
        set({ hintDismissed: true })
      },

      setExportPrefs(patch: Partial<ExportOptions>) {
        // Resolve per-field so an invalid patch value (e.g. a ToggleGroup
        // deselect emitting '') can never enter state — it keeps the
        // previous/default value for that field instead.
        set((s) => ({ exportPrefs: resolveExportOptions({ ...s.exportPrefs, ...patch }) }))
      },

      saveVersion(docId: string, opts = {}) {
        const { label, auto = true } = opts
        const { docs } = get()
        const doc = docs.find((d) => d.id === docId)
        if (!doc) return null
        if (!doc.content.trim()) return null

        const newest = doc.versions[0]
        if (newest && newest.content === doc.content) return null

        const version: VmeVersion = {
          id: crypto.randomUUID(),
          content: doc.content,
          savedAt: Date.now(),
          auto: label ? false : auto,
          ...(label ? { label } : {}),
        }

        const updated = pruneAutoVersions([version, ...doc.versions], AUTO_VERSION_CAP)

        set((s) => ({
          docs: s.docs.map((d) =>
            d.id === docId ? { ...d, versions: updated } : d,
          ),
        }))

        return version.id
      },

      restoreVersion(docId: string, versionId: string) {
        const { docs, saveVersion } = get()
        const doc = docs.find((d) => d.id === docId)
        if (!doc) return
        const target = doc.versions.find((v) => v.id === versionId)
        if (!target) return

        // Snapshot current state first so user can undo
        saveVersion(docId, { label: RESTORE_SNAPSHOT_LABEL, auto: false })

        set((s) => ({
          docs: s.docs.map((d) =>
            d.id === docId
              ? { ...d, content: target.content, updatedAt: Date.now(), versions: pruneRestoreSnapshots(d.versions) }
              : d,
          ),
        }))
      },

      deleteVersion(docId: string, versionId: string) {
        const doc = get().docs.find((d) => d.id === docId)
        if (!doc || !doc.versions.some((v) => v.id === versionId)) return
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id === docId
              ? { ...d, versions: d.versions.filter((v) => v.id !== versionId) }
              : d,
          ),
        }))
      },

      pinVersion(docId: string, versionId: string, label: string) {
        const doc = get().docs.find((d) => d.id === docId)
        if (!doc || !doc.versions.some((v) => v.id === versionId)) return
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id === docId
              ? {
                  ...d,
                  versions: d.versions.map((v) =>
                    v.id === versionId
                      ? { ...v, label: label.trim() || v.label, auto: false }
                      : v,
                  ),
                }
              : d,
          ),
        }))
      },
    }),
    {
      name: STORAGE_KEY,
      merge: mergePersisted,
    },
  ),
)

// ---------------------------------------------------------------------------
// Cloud-backed markdown-editor state (Phase 2 of google-auth-cloud-state).
//
// `useMarkdownEditorState()` below is what `index.tsx` actually consumes.
// Signed out (or auth status still 'loading'): the exact `useVmeStore` above,
// unchanged. Signed in: one `useToolState` row per document
// (`item_id = doc.id`) plus one `'_settings'` row for
// activeDocId/selectedModel/editorMode/hintDismissed/exportPrefs, enumerated
// via `useToolItemList('markdown-editor')` — per
// `swe/google-auth-cloud-state/phases/p2-markdown-editor-pilot.md`. Both
// paths return the exact same `VmeState` shape, so `index.tsx`'s call sites
// are unaffected by which path is active, and switching between them at
// runtime (sign in/out) never crashes and never reads the other path's data.
//
// Design notes for the signed-in path:
// - The settings row additionally carries `docsIndex` — a lightweight
//   `{id, title, updatedAt}[]` list. This exists because `useToolState` is a
//   React hook that must be called an unconditional, fixed number of times
//   per render (Rules of Hooks), but the number of documents is dynamic — so
//   this tool cannot call `useToolState` once per doc, and the fixed Phase 1
//   adapter exposes no batch/list-of-rows read (only `useToolItemList`,
//   which returns ids only, never titles). Instead exactly one extra
//   `useToolState` call is bound to whichever doc is currently active (its
//   `itemId` argument changes across renders — that's fine, it's still the
//   same one hook call each render, just with a different argument), and
//   every OTHER document's list entry (title only, no content/versions)
//   comes from `docsIndex`. `useToolItemList('markdown-editor')` still
//   enumerates the tool's real persisted item ids — used here only to tell
//   a genuinely brand-new signed-in account (no rows at all) apart from one
//   that already has cloud docs, for the one-time bootstrap below.
// - `docsIndex` is the only place a non-active document's title is known
//   without fetching its row. A title change (via `updateDoc`) is written to
//   `docsIndex` (settings row) regardless of which document it targets, and
//   ADDITIONALLY to that document's own row when it happens to be the
//   active one — never to a non-active document's own row (Rules of Hooks
//   means there is no `useToolState` binding available for an arbitrary
//   background document's row). A content change (the overwhelmingly
//   common case — every keystroke) only ever targets the active document
//   in practice (the editor UI shows exactly one document's content at a
//   time) and touches ONLY that document's own row, never the settings
//   row. See the impl report's Deviations section for why title is handled
//   differently from a fully literal "touches only that document's own
//   row" reading.
// - Creating a document writes its row immediately (not deferred) so the
//   "creating a document writes one new row with a fresh item_id"
//   acceptance criterion holds head-on: the new doc's `activeDocId` update
//   (settings row) and the new doc's own row don't bind to the same
//   `useToolState` call in the same render (only ONE doc's row-hook exists,
//   still bound to the *previous* active doc's id at the moment `createDoc`
//   runs), so the actual row write is deferred exactly one render tick via
//   `pendingNewDocRef` + an effect keyed on the (now-updated) active item
//   id — not deferred until the user happens to edit it.
// - `restoreVersion` computes its "Before restore" snapshot and the restored
//   content/versions in a single `setData` call, not two sequential ones —
//   `useToolState`'s mutation is asynchronous (a network round trip), so two
//   sequential calls would both read the same stale `activeDocState.data`
//   and the second would silently clobber the first's snapshot.
// - No import-sweep registration for markdown-editor was added in Phase 2
//   (see that phase's impl report's Notes for the lead) — it is added in
//   Phase 3b of google-auth-cloud-state (see the `registerSweepTarget` call
//   below), reusing the exact `SettingsSchema` shape already defined here.
// ---------------------------------------------------------------------------

const TOOL_ID = 'markdown-editor'
const SETTINGS_ITEM_ID = '_settings'

/**
 * Stable (never `crypto.randomUUID()`) placeholder item id, used only for
 * the `useToolState` call bound to "the active document" while there is no
 * real active doc yet (settings row not loaded, or a brand-new signed-in
 * account before its first doc is created) — never collides with a real
 * doc id or with `'_settings'`.
 */
const PENDING_ITEM_ID = '__pending__'

const DocIndexEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  updatedAt: z.number(),
})

type DocIndexEntry = z.infer<typeof DocIndexEntrySchema>

const SettingsSchema = z.object({
  activeDocId: z.string(),
  selectedModel: ModelSchema,
  editorMode: EditorModeSchema.optional(),
  hintDismissed: z.boolean().optional(),
  exportPrefs: z.unknown().optional(),
  docsIndex: z.array(DocIndexEntrySchema).default([]),
})

type VmeSettings = z.infer<typeof SettingsSchema>

/**
 * `activeDocId: ''` is a deliberate, transient bootstrap value (not
 * `min(1)` in the schema above) — a brand-new signed-in account with zero
 * cloud docs yet has no active doc until the bootstrap effect below creates
 * its first one.
 */
const DEFAULT_SETTINGS: VmeSettings = {
  activeDocId: '',
  selectedModel: 'gpt4o',
  editorMode: 'wysiwyg',
  hintDismissed: false,
  exportPrefs: DEFAULT_EXPORT_OPTIONS,
  docsIndex: [],
}

// ---------------------------------------------------------------------------
// Import-sweep registration (Phase 3b of google-auth-cloud-state).
//
// Unlike every other (single-blob) tool, markdown-editor's local data maps
// onto MULTIPLE sweep items: one per document (`itemId = doc.id`, `data =
// doc`) plus one settings item (`itemId = '_settings'`) built from the
// local store's own top-level fields, with `docsIndex` derived from the
// local `docs[]` array's `{id, title, updatedAt}` — the exact same shape
// `SettingsSchema` already expects for the cloud-backed settings row (see
// the design notes above `useCloudMarkdownEditorState`). Each item is
// validated independently by `decideImport` (in `importSweep.ts`) through
// this target's `schema`, so the schema must accept either shape — a
// `z.union([DocSchema, SettingsSchema])` rather than a single object
// schema, since a single sweep target may carry items of two different
// shapes (docs and the one settings row).
// ---------------------------------------------------------------------------

const SweepItemSchema = z.union([DocSchema, SettingsSchema])

registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => {
    const local = useVmeStore.getState()
    const docItems = local.docs.map((doc) => ({ itemId: doc.id, data: doc }))
    const settingsItem = {
      itemId: SETTINGS_ITEM_ID,
      data: {
        activeDocId: local.activeDocId,
        selectedModel: local.selectedModel,
        editorMode: local.editorMode,
        hintDismissed: local.hintDismissed,
        exportPrefs: local.exportPrefs,
        docsIndex: local.docs.map((doc) => ({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt })),
      },
    }
    return [...docItems, settingsItem]
  },
  schema: SweepItemSchema,
})

/** Stable placeholder doc — never `crypto.randomUUID()` — used only while
 *  the active doc's own `docsIndex` entry hasn't resolved yet, so this hook
 *  never hands `index.tsx` a doc whose id changes on every render. */
const PENDING_DOC: VmeDoc = {
  id: PENDING_ITEM_ID,
  title: 'Untitled',
  content: '',
  updatedAt: 0,
  versions: [],
}

function buildDefaultActiveDoc(docsIndex: DocIndexEntry[], activeDocId: string): VmeDoc {
  const entry = docsIndex.find((d) => d.id === activeDocId)
  if (!entry) return PENDING_DOC
  return { id: entry.id, title: entry.title, content: '', updatedAt: entry.updatedAt, versions: [] }
}

function useCloudMarkdownEditorState(): VmeState {
  const { status } = useAuth()
  const settings = useToolState(TOOL_ID, SETTINGS_ITEM_ID, SettingsSchema, DEFAULT_SETTINGS)
  const itemList = useToolItemList(TOOL_ID)
  const { deleteItem } = useDeleteToolItem(TOOL_ID)

  const settingsData = settings.data
  const docsIndex = settingsData.docsIndex
  const activeDocId = settingsData.activeDocId
  const activeItemId = activeDocId || PENDING_ITEM_ID

  const defaultActiveDoc = buildDefaultActiveDoc(docsIndex, activeDocId)
  const activeDocState = useToolState(TOOL_ID, activeItemId, DocSchema, defaultActiveDoc)

  // Holds a freshly-created doc awaiting its own row write, until the
  // *next* render rebinds `activeDocState` to its id (see the "Creating a
  // document writes its row immediately" design note above).
  const pendingNewDocRef = useRef<VmeDoc | null>(null)

  useEffect(() => {
    const pending = pendingNewDocRef.current
    if (pending && pending.id === activeItemId) {
      activeDocState.setData(pending)
      pendingNewDocRef.current = null
    }
    // Only `activeItemId` should re-trigger this — it's the one value that
    // tells us `activeDocState` is now bound to the pending doc's id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItemId])

  // One-time bootstrap: a brand-new signed-in account with zero cloud docs
  // ever (no rows at all, no docsIndex) gets a starter doc, mirroring the
  // signed-out `fallbackState()`. Guarded to (a) never run while signed
  // out — this hook is always mounted regardless of auth status (Rules of
  // Hooks), so without this guard it would create/persist a starter doc's
  // settings row using the signed-out local-storage path, which the
  // Contract forbids ("no new localStorage key... ever" for the signed-out
  // path) — and (b) fire at most once per mount, only once both the
  // settings row and the item list have actually resolved, so it can never
  // race a real doc that simply hasn't arrived over the network yet.
  const bootstrappedRef = useRef(false)
  useEffect(() => {
    if (status !== 'signed-in') return
    if (bootstrappedRef.current) return
    if (settings.isLoading || itemList.isLoading) return
    bootstrappedRef.current = true
    const hasAnyRealDoc =
      docsIndex.length > 0 || itemList.itemIds.some((id) => id !== SETTINGS_ITEM_ID)
    if (hasAnyRealDoc) return
    const doc = makeDoc('Untitled 1')
    pendingNewDocRef.current = doc
    settings.setData({
      ...settingsData,
      activeDocId: doc.id,
      docsIndex: [{ id: doc.id, title: doc.title, updatedAt: doc.updatedAt }],
    })
    // Deliberately narrow deps: only status/loading flags gate whether this
    // fires; `bootstrappedRef` makes it idempotent regardless of what else
    // changes across renders (docsIndex/settingsData are read fresh from
    // the closure at the moment it actually runs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, settings.isLoading, itemList.isLoading])

  const docs: VmeDoc[] =
    docsIndex.length > 0
      ? docsIndex.map((entry) =>
          entry.id === activeDocId
            ? activeDocState.data
            : { id: entry.id, title: entry.title, content: '', updatedAt: entry.updatedAt, versions: [] },
        )
      : [activeDocState.data]

  function updateSettings(patch: Partial<VmeSettings>) {
    settings.setData({ ...settingsData, ...patch })
  }

  function createDoc() {
    const title = generateDocTitle(docsIndex.map((d) => d.title))
    const doc = makeDoc(title)
    pendingNewDocRef.current = doc
    updateSettings({
      activeDocId: doc.id,
      docsIndex: [...docsIndex, { id: doc.id, title: doc.title, updatedAt: doc.updatedAt }],
    })
  }

  function deleteDoc(id: string) {
    if (docsIndex.length <= 1) return // never delete the last doc
    const nextIndex = docsIndex.filter((d) => d.id !== id)
    const newActive = activeDocId === id ? nextIndex[0].id : activeDocId
    updateSettings({ activeDocId: newActive, docsIndex: nextIndex })
    deleteItem(id)
  }

  function updateDoc(id: string, patch: Partial<Pick<VmeDoc, 'title' | 'content'>>) {
    const now = Date.now()
    // Content updates touch ONLY the active document's own row — never the
    // settings row, never any other document's row — matching the
    // acceptance criterion's literal wording. (Content can only ever be
    // edited for the active document — the editor UI only ever shows one
    // document's content at a time — so `id !== activeDocId` never
    // legitimately carries a content patch in practice; the guard below
    // still keeps that invariant explicit and safe.)
    if (patch.content !== undefined && id === activeDocId) {
      activeDocState.setData({ ...activeDocState.data, content: patch.content, updatedAt: now })
    }
    if (patch.title !== undefined) {
      const title = patch.title
      // Title is the one field the sidebar list must display correctly for
      // EVERY document, including ones that are not currently active (the
      // side panel's rename control targets any doc in the list) — and
      // `docsIndex` (the settings row) is the only place a non-active
      // document's title is knowable without fetching its own row, which
      // Rules of Hooks makes impossible to do for an arbitrary, dynamic-
      // count set of background documents. So a title change (only — never
      // a content change) is written to `docsIndex` regardless of which
      // document it targets, in addition to the active document's own row
      // when the renamed document happens to be the active one. This is a
      // disclosed, deliberate deviation from a fully literal "title updates
      // touch only that document's own row" reading, made because the
      // phase goal explicitly allows deviating from "component call sites
      // keep working unchanged" only "wherever that can be avoided" — see
      // the impl report's Deviations section.
      if (id === activeDocId) {
        activeDocState.setData({ ...activeDocState.data, title, updatedAt: now })
      }
      updateSettings({
        docsIndex: docsIndex.map((d) => (d.id === id ? { ...d, title, updatedAt: now } : d)),
      })
    }
  }

  function setActiveDoc(id: string) {
    updateSettings({ activeDocId: id })
  }

  function setModel(m: VmeModel) {
    updateSettings({ selectedModel: m })
  }

  function setEditorMode(mode: VmeEditorMode) {
    updateSettings({ editorMode: mode })
  }

  function dismissHint() {
    updateSettings({ hintDismissed: true })
  }

  function setExportPrefs(patch: Partial<ExportOptions>) {
    updateSettings({
      exportPrefs: resolveExportOptions({ ...resolveExportOptions(settingsData.exportPrefs), ...patch }),
    })
  }

  function saveVersion(docId: string, opts: { label?: string; auto?: boolean } = {}): string | null {
    if (docId !== activeDocId) return null
    const doc = activeDocState.data
    if (!doc.content.trim()) return null

    const newest = doc.versions[0]
    if (newest && newest.content === doc.content) return null

    const { label, auto = true } = opts
    const version: VmeVersion = {
      id: crypto.randomUUID(),
      content: doc.content,
      savedAt: Date.now(),
      auto: label ? false : auto,
      ...(label ? { label } : {}),
    }
    const updated = pruneAutoVersions([version, ...doc.versions], AUTO_VERSION_CAP)
    activeDocState.setData({ ...doc, versions: updated })
    return version.id
  }

  function restoreVersion(docId: string, versionId: string) {
    if (docId !== activeDocId) return
    const doc = activeDocState.data
    const target = doc.versions.find((v) => v.id === versionId)
    if (!target) return

    // Snapshot current content first (same dedup rule as saveVersion: skip
    // if identical to the newest version) — combined into the SAME update
    // as the restore itself. Two sequential setData calls here would both
    // read this same (stale, pre-mutation) `doc` — the cloud mutation is a
    // network round trip, not a synchronous set() — so the second call
    // would silently clobber the first's snapshot.
    let versions = doc.versions
    const newest = doc.versions[0]
    if (doc.content.trim() && !(newest && newest.content === doc.content)) {
      const snapshot: VmeVersion = {
        id: crypto.randomUUID(),
        content: doc.content,
        savedAt: Date.now(),
        auto: false,
        label: RESTORE_SNAPSHOT_LABEL,
      }
      versions = [snapshot, ...versions]
    }

    activeDocState.setData({
      ...doc,
      content: target.content,
      updatedAt: Date.now(),
      versions: pruneRestoreSnapshots(versions),
    })
  }

  function deleteVersion(docId: string, versionId: string) {
    if (docId !== activeDocId) return
    const doc = activeDocState.data
    if (!doc.versions.some((v) => v.id === versionId)) return
    activeDocState.setData({ ...doc, versions: doc.versions.filter((v) => v.id !== versionId) })
  }

  function pinVersion(docId: string, versionId: string, label: string) {
    if (docId !== activeDocId) return
    const doc = activeDocState.data
    if (!doc.versions.some((v) => v.id === versionId)) return
    activeDocState.setData({
      ...doc,
      versions: doc.versions.map((v) =>
        v.id === versionId ? { ...v, label: label.trim() || v.label, auto: false } : v,
      ),
    })
  }

  return {
    docs,
    activeDocId: activeDocId || docs[0]?.id || PENDING_ITEM_ID,
    selectedModel: settingsData.selectedModel,
    editorMode: settingsData.editorMode ?? 'wysiwyg',
    hintDismissed: settingsData.hintDismissed ?? false,
    exportPrefs: resolveExportOptions(settingsData.exportPrefs),
    createDoc,
    deleteDoc,
    updateDoc,
    setActiveDoc,
    setModel,
    setEditorMode,
    dismissHint,
    setExportPrefs,
    saveVersion,
    restoreVersion,
    deleteVersion,
    pinVersion,
  }
}

/**
 * The hook `index.tsx` actually consumes. Signed out (or auth status still
 * `'loading'`, e.g. the brief window before the initial session check
 * resolves): the existing local Zustand `persist` store above, unchanged.
 * Signed in: the cloud-backed implementation above.
 *
 * Both `useVmeStore()` and `useCloudMarkdownEditorState()` are called on
 * every render regardless of `status` — Rules of Hooks requires a hook's
 * call count to never vary across renders of the same component instance;
 * only the *returned value* differs by branch. This mirrors how
 * `useToolState` itself is built (it always calls both its local-store and
 * React Query hooks, branching only on what it returns). The cloud half's
 * own internal effects are separately guarded (see above) to never write
 * anything while signed out.
 */
export function useMarkdownEditorState(): VmeState {
  const { status } = useAuth()
  const local = useVmeStore()
  const cloud = useCloudMarkdownEditorState()
  return status === 'signed-in' ? cloud : local
}
