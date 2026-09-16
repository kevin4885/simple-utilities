import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { IndentOption } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

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

const DEFAULT_STATE: JsonFormatterPersistedState = {
  content: '',
  indent: 2,
  sortKeys: false,
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalJsonFormatterStore = create<JsonFormatterState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

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

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'json-formatter'

// Import-sweep registration (Phase 3b of google-auth-cloud-state): on first
// sign-in, the sweep imports this tool's current local data into the cloud
// if no cloud row exists yet for this user/tool. See importSweep.io.ts.
registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => [{ itemId: 'default', data: useLocalJsonFormatterStore.getState() }],
  schema: JsonFormatterSchema,
})

function useJsonFormatterStoreImpl(): JsonFormatterState {
  const { status } = useAuth()
  const local = useLocalJsonFormatterStore()
  const cloud = useToolState(TOOL_ID, 'default', JsonFormatterSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    content: data.content,
    indent: data.indent,
    sortKeys: data.sortKeys,
    setContent: (content) => cloud.setData({ ...data, content }),
    setIndent: (indent) => cloud.setData({ ...data, indent }),
    setSortKeys: (sortKeys) => cloud.setData({ ...data, sortKeys }),
  }
}

export const useJsonFormatterStore = Object.assign(useJsonFormatterStoreImpl, {
  getState: () => useLocalJsonFormatterStore.getState(),
  setState: (partial: Partial<JsonFormatterState>) => useLocalJsonFormatterStore.setState(partial),
})
