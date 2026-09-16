import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { Base64Variant } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

// ── Schema ────────────────────────────────────────────────────────────────────

const Base64EncoderSchema = z.object({
  /** Current text in the input textarea */
  input: z.string().default(''),
  /** 'encode' = plain text → Base64; 'decode' = Base64 → plain text */
  direction: z.enum(['encode', 'decode']).default('encode'),
  /** Which Base64 alphabet to use */
  variant: z.enum(['standard', 'url']).default('standard'),
})

export type Base64EncoderPersistedState = z.infer<typeof Base64EncoderSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface Base64EncoderState extends Base64EncoderPersistedState {
  setInput: (input: string) => void
  setDirection: (direction: 'encode' | 'decode') => void
  setVariant: (variant: Base64Variant) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: Base64EncoderState,
): Base64EncoderState {
  const result = Base64EncoderSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

const DEFAULT_STATE: Base64EncoderPersistedState = {
  input: '',
  direction: 'encode',
  variant: 'standard',
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalBase64EncoderStore = create<Base64EncoderState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setInput: (input) => set({ input }),
      setDirection: (direction) => set({ direction }),
      setVariant: (variant) => set({ variant }),
    }),
    {
      name: 'su:base64-encoder',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as Base64EncoderState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'base64-encoder'

// Import-sweep registration (Phase 3b of google-auth-cloud-state): on first
// sign-in, the sweep imports this tool's current local data into the cloud
// if no cloud row exists yet for this user/tool. See importSweep.io.ts.
registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => [{ itemId: 'default', data: useLocalBase64EncoderStore.getState() }],
  schema: Base64EncoderSchema,
})

function useBase64EncoderStoreImpl(): Base64EncoderState {
  const { status } = useAuth()
  const local = useLocalBase64EncoderStore()
  const cloud = useToolState(TOOL_ID, 'default', Base64EncoderSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    input: data.input,
    direction: data.direction,
    variant: data.variant,
    setInput: (input) => cloud.setData({ ...data, input }),
    setDirection: (direction) => cloud.setData({ ...data, direction }),
    setVariant: (variant) => cloud.setData({ ...data, variant }),
  }
}

export const useBase64EncoderStore = Object.assign(useBase64EncoderStoreImpl, {
  getState: () => useLocalBase64EncoderStore.getState(),
  setState: (partial: Partial<Base64EncoderState>) => useLocalBase64EncoderStore.setState(partial),
})
