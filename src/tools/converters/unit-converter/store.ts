import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { UNIT_CATEGORIES, CATEGORIES } from './logic'

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * Per-category state: the selected from-unit and to-unit.
 * Stored as a flat record keyed by category id.
 */
const CategoryStateSchema = z.object({
  fromUnit: z.string().default(''),
  toUnit:   z.string().default(''),
})

const UnitConverterSchema = z.object({
  /** The currently selected unit category id. */
  activeCategory: z.string().default(UNIT_CATEGORIES[0]),
  /** Per-category from/to unit selections. */
  unitSelections: z.record(z.string(), CategoryStateSchema).default({}),
  /** The raw numeric input string (shared across categories). */
  inputValue: z.string().default(''),
})

export type UnitConverterPersistedState = z.infer<typeof UnitConverterSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface UnitConverterState extends UnitConverterPersistedState {
  setActiveCategory: (category: string) => void
  setFromUnit: (category: string, unit: string) => void
  setToUnit: (category: string, unit: string) => void
  setInputValue: (value: string) => void
  swapUnits: (category: string) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: UnitConverterState,
): UnitConverterState {
  const result = UnitConverterSchema.partial().safeParse(persisted)
  if (!result.success) return current

  const data = result.data

  // Reset activeCategory to default if the persisted value is no longer valid
  if (data.activeCategory !== undefined && !UNIT_CATEGORIES.includes(data.activeCategory)) {
    data.activeCategory = UNIT_CATEGORIES[0]
  }

  return { ...current, ...data }
}

// ── Defaults ──────────────────────────────────────────────────────────────────

/**
 * Return sensible default from/to unit ids for a given category.
 * Falls back to the first two units if the category has them, or empty strings.
 */
export function defaultUnitsForCategory(categoryId: string): { fromUnit: string; toUnit: string } {
  const cat = CATEGORIES[categoryId]
  if (!cat || cat.units.length < 2) return { fromUnit: '', toUnit: '' }
  return { fromUnit: cat.units[0].id, toUnit: cat.units[1].id }
}

/**
 * Build the initial unit selections for all categories.
 */
function buildDefaultSelections(): Record<string, { fromUnit: string; toUnit: string }> {
  const out: Record<string, { fromUnit: string; toUnit: string }> = {}
  for (const id of UNIT_CATEGORIES) {
    out[id] = defaultUnitsForCategory(id)
  }
  return out
}

const DEFAULT_SELECTIONS = buildDefaultSelections()

// ── Store ─────────────────────────────────────────────────────────────────────

export const useUnitConverterStore = create<UnitConverterState>()(
  persist(
    (set) => ({
      activeCategory: UNIT_CATEGORIES[0],
      unitSelections: DEFAULT_SELECTIONS,
      inputValue: '',

      setActiveCategory: (category) => set({ activeCategory: category }),

      setFromUnit: (category, unit) =>
        set((state) => ({
          unitSelections: {
            ...state.unitSelections,
            [category]: { ...(state.unitSelections[category] ?? defaultUnitsForCategory(category)), fromUnit: unit },
          },
        })),

      setToUnit: (category, unit) =>
        set((state) => ({
          unitSelections: {
            ...state.unitSelections,
            [category]: { ...(state.unitSelections[category] ?? defaultUnitsForCategory(category)), toUnit: unit },
          },
        })),

      setInputValue: (value) => set({ inputValue: value }),

      swapUnits: (category) =>
        set((state) => {
          const sel = state.unitSelections[category] ?? defaultUnitsForCategory(category)
          return {
            unitSelections: {
              ...state.unitSelections,
              [category]: { fromUnit: sel.toUnit, toUnit: sel.fromUnit },
            },
          }
        }),
    }),
    {
      name: 'su:unit-converter',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as UnitConverterState),
    },
  ),
)
