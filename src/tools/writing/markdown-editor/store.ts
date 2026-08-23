import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { generateDocTitle } from './logic'

// ---------------------------------------------------------------------------
// Schema (Zod — validates on rehydrate)
// ---------------------------------------------------------------------------

const DocSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  updatedAt: z.number(),
})

const ModelSchema = z.enum(['gpt4o', 'claude', 'gemini'])

const PersistedSchema = z.object({
  docs: z.array(DocSchema).min(1),
  activeDocId: z.string().min(1),
  selectedModel: ModelSchema,
})

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
