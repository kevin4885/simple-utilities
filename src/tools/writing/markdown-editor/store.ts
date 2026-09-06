/**
 * Markdown Editor — Zustand store (persisted to localStorage under
 * `su:markdown-editor`, see STORAGE_KEY in ./logic).
 *
 * Before the persist middleware is created, `migrateLegacyStorage` runs once
 * to move any data left under the old `su:visual-markdown-editor` key (used
 * by this tool when it was still named "Visual Markdown Editor") to the new
 * key, discarding whatever the old CodeMirror-only "Markdown Editor" tool had
 * stored there.
 */
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
