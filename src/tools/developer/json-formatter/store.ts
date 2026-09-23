import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { IndentOption } from './logic'

// ── Schema ────────────────────────────────────────────────────────────────────

const JsonFormatterSchema = z.object({
  content: z.string().default(''),
  indent: z.union([z.literal(2), z.literal(4), z.literal('tab')]).default(2),
  sortKeys: z.boolean().default(false),
})

export type JsonFormatterPersistedState = z.infer<typeof JsonFormatterSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface JsonFormatterState extends JsonFormatterPersistedState {
  setContent: (content: string) => void
  setIndent: (indent: IndentOption) => void
  setSortKeys: (sortKeys: boolean) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: JsonFormatterState,
): JsonFormatterState {
  const result = JsonFormatterSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useJsonFormatterStore = create<JsonFormatterState>()(
  persist(
    (set) => ({
      content: '',
      indent: 2,
      sortKeys: false,

      setContent: (content) => set({ content }),
      setIndent: (indent) => set({ indent }),
      setSortKeys: (sortKeys) => set({ sortKeys }),
    }),
    {
      name: 'su:json-formatter',
      merge: (persisted, current) => mergePersisted(persisted, current as JsonFormatterState),
    },
  ),
)
