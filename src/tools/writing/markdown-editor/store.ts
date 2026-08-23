import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { generateDocTitle, pruneAutoVersions, AUTO_VERSION_CAP } from './logic'

// ---------------------------------------------------------------------------
// Schema (Zod — validates on rehydrate)
// ---------------------------------------------------------------------------

const VersionSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
  savedAt: z.number(),
  /** User-supplied name for pinned versions. */
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

const PersistedSchema = z.object({
  docs: z.array(DocSchema).min(1),
  activeDocId: z.string().min(1),
  selectedModel: ModelSchema,
})

export type Version = z.infer<typeof VersionSchema>
export type Doc = z.infer<typeof DocSchema>
export type Model = z.infer<typeof ModelSchema>

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface MarkdownEditorState {
  docs: Doc[]
  activeDocId: string
  selectedModel: Model

  createDoc: () => void
  deleteDoc: (id: string) => void
  updateDoc: (id: string, patch: Partial<Pick<Doc, 'title' | 'content'>>) => void
  setActiveDoc: (id: string) => void
  setModel: (m: Model) => void

  /**
   * Capture the current content of `docId` as a new version entry.
   * Auto-versions beyond AUTO_VERSION_CAP are pruned (oldest first).
   * Supply `label` to create a pinned (non-auto) version instead.
   * Returns the new version's id, or null if content is empty or identical
   * to the most recent version (skip duplicate snapshots).
   */
  saveVersion: (docId: string, opts?: { label?: string; auto?: boolean }) => string | null

  /**
   * Restore a previously saved version.
   * 1. Saves the current content as an auto-version labelled "Before restore" first.
   * 2. Updates doc.content to the version's content.
   * Returns the "before restore" snapshot id so callers can clear EditorState.
   */
  restoreVersion: (docId: string, versionId: string) => void

  /** Permanently delete a single version entry. */
  deleteVersion: (docId: string, versionId: string) => void

  /** Rename / pin an auto version by setting a label (auto becomes false). */
  pinVersion: (docId: string, versionId: string, label: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(title: string): Doc {
  return {
    id: crypto.randomUUID(),
    title,
    content: '',
    updatedAt: Date.now(),
    versions: [],
  }
}

function fallbackState(): Pick<MarkdownEditorState, 'docs' | 'activeDocId' | 'selectedModel'> {
  const doc = makeDoc('Untitled 1')
  return { docs: [doc], activeDocId: doc.id, selectedModel: 'gpt4o' }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useMarkdownEditorStore = create<MarkdownEditorState>()(
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

      updateDoc(id: string, patch: Partial<Pick<Doc, 'title' | 'content'>>) {
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d,
          ),
        }))
      },

      setActiveDoc(id: string) {
        set({ activeDocId: id })
      },

      setModel(m: Model) {
        set({ selectedModel: m })
      },

      saveVersion(docId: string, opts = {}) {
        const { label, auto = true } = opts
        const { docs } = get()
        const doc = docs.find((d) => d.id === docId)
        if (!doc) return null

        // Skip if content is empty
        if (!doc.content.trim()) return null

        // Skip duplicate — same content as the most recent version
        const newest = doc.versions[0]
        if (newest && newest.content === doc.content) return null

        const version: Version = {
          id: crypto.randomUUID(),
          content: doc.content,
          savedAt: Date.now(),
          auto: label ? false : auto,
          ...(label ? { label } : {}),
        }

        // Prepend newest first, then prune excess auto-versions
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

        // 1. Snapshot current state before overwriting so user can get back
        saveVersion(docId, { label: 'Before restore', auto: false })

        // 2. Apply the version content
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id === docId
              ? { ...d, content: target.content, updatedAt: Date.now() }
              : d,
          ),
        }))
      },

      deleteVersion(docId: string, versionId: string) {
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id === docId
              ? { ...d, versions: d.versions.filter((v) => v.id !== versionId) }
              : d,
          ),
        }))
      },

      pinVersion(docId: string, versionId: string, label: string) {
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id === docId
              ? {
                  ...d,
                  versions: d.versions.map((v) =>
                    v.id === versionId ? { ...v, label: label.trim() || v.label, auto: false } : v,
                  ),
                }
              : d,
          ),
        }))
      },
    }),
    {
      name: 'su:markdown-editor',
      // Validate + sanitise on rehydrate; fall back to clean state on corruption
      merge(persisted, current) {
        const result = PersistedSchema.safeParse(persisted)
        if (!result.success) return current
        const { docs, activeDocId, selectedModel } = result.data
        // Ensure activeDocId actually exists in docs
        const validId = docs.find((d) => d.id === activeDocId) ? activeDocId : docs[0].id
        return { ...current, docs, activeDocId: validId, selectedModel }
      },
    },
  ),
)
