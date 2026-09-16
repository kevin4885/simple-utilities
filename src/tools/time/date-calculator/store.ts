/**
 * Date Calculator — Zustand persist store
 *
 * Persists section inputs under localStorage key "su:date-calculator".
 * Rehydrated state is validated with Zod; invalid/missing fields fall back to defaults.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { AddUnit } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'

// ── Schema ─────────────────────────────────────────────────────────────────────

const DateCalculatorSchema = z.object({
  // Section 1: Days between dates
  betweenStartDate: z.string().default(''),
  betweenEndDate: z.string().default(''),
  betweenIncludeEnd: z.boolean().default(false),

  // Section 2: Add/subtract from a date
  addBaseDate: z.string().default(''),
  addAmount: z.string().default('1'),
  addUnit: z
    .enum(['days', 'weeks', 'months', 'years', 'businessDays'])
    .default('days'),
  addDirection: z.enum(['add', 'subtract']).default('add'),

  // Section 3: Age calculator
  ageBirthDate: z.string().default(''),

  // Section 4: Countdown
  countdownTarget: z.string().default(''),

  // Active tab
  activeTab: z
    .enum(['between', 'add', 'age', 'countdown'])
    .default('between'),
})

export type DateCalculatorPersistedState = z.infer<typeof DateCalculatorSchema>

// ── Store state ────────────────────────────────────────────────────────────────

export interface DateCalculatorState extends DateCalculatorPersistedState {
  setBetweenStartDate: (v: string) => void
  setBetweenEndDate: (v: string) => void
  setBetweenIncludeEnd: (v: boolean) => void

  setAddBaseDate: (v: string) => void
  setAddAmount: (v: string) => void
  setAddUnit: (v: AddUnit) => void
  setAddDirection: (v: 'add' | 'subtract') => void

  setAgeBirthDate: (v: string) => void

  setCountdownTarget: (v: string) => void

  setActiveTab: (v: DateCalculatorPersistedState['activeTab']) => void
}

// ── Rehydration ────────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: DateCalculatorState,
): DateCalculatorState {
  const result = DateCalculatorSchema.partial().safeParse(persisted)
  if (!result.success) return current
  return { ...current, ...result.data }
}

const DEFAULT_STATE: DateCalculatorPersistedState = {
  betweenStartDate: '',
  betweenEndDate: '',
  betweenIncludeEnd: false,

  addBaseDate: '',
  addAmount: '1',
  addUnit: 'days',
  addDirection: 'add',

  ageBirthDate: '',
  countdownTarget: '',
  activeTab: 'between',
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalDateCalculatorStore = create<DateCalculatorState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setBetweenStartDate: (betweenStartDate) => set({ betweenStartDate }),
      setBetweenEndDate: (betweenEndDate) => set({ betweenEndDate }),
      setBetweenIncludeEnd: (betweenIncludeEnd) => set({ betweenIncludeEnd }),

      setAddBaseDate: (addBaseDate) => set({ addBaseDate }),
      setAddAmount: (addAmount) => set({ addAmount }),
      setAddUnit: (addUnit) => set({ addUnit }),
      setAddDirection: (addDirection) => set({ addDirection }),

      setAgeBirthDate: (ageBirthDate) => set({ ageBirthDate }),

      setCountdownTarget: (countdownTarget) => set({ countdownTarget }),

      setActiveTab: (activeTab) => set({ activeTab }),
    }),
    {
      name: 'su:date-calculator',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as DateCalculatorState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'date-calculator'

function useDateCalculatorStoreImpl(): DateCalculatorState {
  const { status } = useAuth()
  const local = useLocalDateCalculatorStore()
  const cloud = useToolState(TOOL_ID, 'default', DateCalculatorSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    betweenStartDate: data.betweenStartDate,
    betweenEndDate: data.betweenEndDate,
    betweenIncludeEnd: data.betweenIncludeEnd,
    addBaseDate: data.addBaseDate,
    addAmount: data.addAmount,
    addUnit: data.addUnit,
    addDirection: data.addDirection,
    ageBirthDate: data.ageBirthDate,
    countdownTarget: data.countdownTarget,
    activeTab: data.activeTab,
    setBetweenStartDate: (v) => cloud.setData({ ...data, betweenStartDate: v }),
    setBetweenEndDate: (v) => cloud.setData({ ...data, betweenEndDate: v }),
    setBetweenIncludeEnd: (v) => cloud.setData({ ...data, betweenIncludeEnd: v }),
    setAddBaseDate: (v) => cloud.setData({ ...data, addBaseDate: v }),
    setAddAmount: (v) => cloud.setData({ ...data, addAmount: v }),
    setAddUnit: (v) => cloud.setData({ ...data, addUnit: v }),
    setAddDirection: (v) => cloud.setData({ ...data, addDirection: v }),
    setAgeBirthDate: (v) => cloud.setData({ ...data, ageBirthDate: v }),
    setCountdownTarget: (v) => cloud.setData({ ...data, countdownTarget: v }),
    setActiveTab: (v) => cloud.setData({ ...data, activeTab: v }),
  }
}

export const useDateCalculatorStore = Object.assign(useDateCalculatorStoreImpl, {
  getState: () => useLocalDateCalculatorStore.getState(),
  setState: (partial: Partial<DateCalculatorState>) => useLocalDateCalculatorStore.setState(partial),
})
