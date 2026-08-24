import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { Base64Variant } from './logic'

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

// ── Store ─────────────────────────────────────────────────────────────────────

export const useBase64EncoderStore = create<Base64EncoderState>()(
  persist(
    (set) => ({
      input: '',
      direction: 'encode',
      variant: 'standard',

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
