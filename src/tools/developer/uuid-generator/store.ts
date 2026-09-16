import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { IdType, UuidFormatOptions } from './logic'
import { NANOID_DEFAULT_ALPHABET, NANOID_MIN_LENGTH, NANOID_MAX_LENGTH } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

// ── Schema ────────────────────────────────────────────────────────────────────

const UuidGeneratorSchema = z.object({
  /** Which identifier type to generate */
  idType: z.enum(['uuidv4', 'uuidv7', 'ulid', 'nanoid']).default('uuidv4'),
  /** How many identifiers to generate at once */
  count: z.number().int().min(1).max(1000).default(1),
  /** UUID casing option */
  casing: z.enum(['lower', 'upper']).default('lower'),
  /** Whether UUID output includes hyphens */
  hyphens: z.boolean().default(true),
  /** Length for Nano ID output */
  nanoIdLength: z
    .number()
    .int()
    .min(NANOID_MIN_LENGTH)
    .max(NANOID_MAX_LENGTH)
    .default(21),
})

export type UuidGeneratorPersistedState = z.infer<typeof UuidGeneratorSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface UuidGeneratorState extends UuidGeneratorPersistedState {
  setIdType: (idType: IdType) => void
  setCount: (count: number) => void
  setCasing: (casing: UuidFormatOptions['casing']) => void
  setHyphens: (hyphens: boolean) => void
  setNanoIdLength: (length: number) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: UuidGeneratorState,
): UuidGeneratorState {
  const result = UuidGeneratorSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

const DEFAULT_STATE: UuidGeneratorPersistedState = {
  idType: 'uuidv4',
  count: 1,
  casing: 'lower',
  hyphens: true,
  nanoIdLength: 21,
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalUuidGeneratorStore = create<UuidGeneratorState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setIdType: (idType) => set({ idType }),
      setCount: (count) => set({ count }),
      setCasing: (casing) => set({ casing }),
      setHyphens: (hyphens) => set({ hyphens }),
      setNanoIdLength: (nanoIdLength) => set({ nanoIdLength }),
    }),
    {
      name: 'su:uuid-generator',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as UuidGeneratorState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'uuid-generator'

// Import-sweep registration (Phase 3b of google-auth-cloud-state): on first
// sign-in, the sweep imports this tool's current local data into the cloud
// if no cloud row exists yet for this user/tool. See importSweep.io.ts.
registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => [{ itemId: 'default', data: useLocalUuidGeneratorStore.getState() }],
  schema: UuidGeneratorSchema,
})

function useUuidGeneratorStoreImpl(): UuidGeneratorState {
  const { status } = useAuth()
  const local = useLocalUuidGeneratorStore()
  const cloud = useToolState(TOOL_ID, 'default', UuidGeneratorSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    idType: data.idType,
    count: data.count,
    casing: data.casing,
    hyphens: data.hyphens,
    nanoIdLength: data.nanoIdLength,
    setIdType: (idType) => cloud.setData({ ...data, idType }),
    setCount: (count) => cloud.setData({ ...data, count }),
    setCasing: (casing) => cloud.setData({ ...data, casing }),
    setHyphens: (hyphens) => cloud.setData({ ...data, hyphens }),
    setNanoIdLength: (nanoIdLength) => cloud.setData({ ...data, nanoIdLength }),
  }
}

export const useUuidGeneratorStore = Object.assign(useUuidGeneratorStoreImpl, {
  getState: () => useLocalUuidGeneratorStore.getState(),
  setState: (partial: Partial<UuidGeneratorState>) => useLocalUuidGeneratorStore.setState(partial),
})

export { NANOID_DEFAULT_ALPHABET }
