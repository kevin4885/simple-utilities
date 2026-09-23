import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { IdType, UuidFormatOptions } from './logic'
import { NANOID_DEFAULT_ALPHABET, NANOID_MIN_LENGTH, NANOID_MAX_LENGTH } from './logic'

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

// ── Store ─────────────────────────────────────────────────────────────────────

export const useUuidGeneratorStore = create<UuidGeneratorState>()(
  persist(
    (set) => ({
      idType: 'uuidv4',
      count: 1,
      casing: 'lower',
      hyphens: true,
      nanoIdLength: 21,

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

export { NANOID_DEFAULT_ALPHABET }
