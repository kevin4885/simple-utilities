import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type { RoundUpMode, CurrencyCode } from './logic'
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'

// ── Schema ────────────────────────────────────────────────────────────────────
//
// No .default() here — defaults live in the Zustand factory below.
// Omitting defaults means .partial().safeParse() gives undefined for missing
// fields rather than defaults, which lets mergePersisted safely spread only the
// keys that were actually in localStorage without overwriting the store's own
// defaults for any newly-added fields.

const BillSplitterSchema = z.object({
  /** Raw decimal string for the bill amount */
  billStr: z.string(),
  /** Raw decimal string for the optional tax amount */
  taxStr: z.string(),
  /** Tip percentage (0–200) */
  tipPct: z.number().min(0).max(200),
  /** Whether the tip is on pre-tax amount (when tax is provided) */
  tipOnPreTax: z.boolean(),
  /** Number of people splitting the bill */
  people: z.number().int().min(1).max(100),
  /** Round-up mode for per-person amounts */
  roundUpMode: z.enum(['none', 'dollar', 'half']),
  /** Currency code */
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']),
})

export type BillSplitterPersistedState = z.infer<typeof BillSplitterSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface BillSplitterState extends BillSplitterPersistedState {
  setBillStr: (billStr: string) => void
  setTaxStr: (taxStr: string) => void
  setTipPct: (tipPct: number) => void
  setTipOnPreTax: (tipOnPreTax: boolean) => void
  setPeople: (people: number) => void
  setRoundUpMode: (roundUpMode: RoundUpMode) => void
  setCurrency: (currency: CurrencyCode) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: BillSplitterState,
): BillSplitterState {
  const result = BillSplitterSchema.partial().safeParse(persisted)
  if (!result.success) return current
  // Filter out undefined so that missing fields (schema omits defaults) don't
  // overwrite the store's own defaults for fields added in future versions.
  const patch: Partial<BillSplitterPersistedState> = {}
  for (const [k, v] of Object.entries(result.data) as [keyof BillSplitterPersistedState, unknown][]) {
    if (v !== undefined) (patch as Record<string, unknown>)[k] = v
  }
  return { ...current, ...patch }
}

const DEFAULT_STATE: BillSplitterPersistedState = {
  billStr: '',
  taxStr: '',
  tipPct: 18,
  tipOnPreTax: false,
  people: 2,
  roundUpMode: 'none',
  currency: 'USD',
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalBillSplitterStore = create<BillSplitterState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setBillStr: (billStr) => set({ billStr }),
      setTaxStr: (taxStr) => set({ taxStr }),
      setTipPct: (tipPct) => set({ tipPct }),
      setTipOnPreTax: (tipOnPreTax) => set({ tipOnPreTax }),
      setPeople: (people) => set({ people }),
      setRoundUpMode: (roundUpMode) => set({ roundUpMode }),
      setCurrency: (currency) => set({ currency }),
    }),
    {
      name: 'su:bill-splitter',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as BillSplitterState),
    },
  ),
)

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'bill-splitter'

function useBillSplitterStoreImpl(): BillSplitterState {
  const { status } = useAuth()
  const local = useLocalBillSplitterStore()
  const cloud = useToolState(TOOL_ID, 'default', BillSplitterSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    billStr: data.billStr,
    taxStr: data.taxStr,
    tipPct: data.tipPct,
    tipOnPreTax: data.tipOnPreTax,
    people: data.people,
    roundUpMode: data.roundUpMode,
    currency: data.currency,
    setBillStr: (billStr) => cloud.setData({ ...data, billStr }),
    setTaxStr: (taxStr) => cloud.setData({ ...data, taxStr }),
    setTipPct: (tipPct) => cloud.setData({ ...data, tipPct }),
    setTipOnPreTax: (tipOnPreTax) => cloud.setData({ ...data, tipOnPreTax }),
    setPeople: (people) => cloud.setData({ ...data, people }),
    setRoundUpMode: (roundUpMode) => cloud.setData({ ...data, roundUpMode }),
    setCurrency: (currency) => cloud.setData({ ...data, currency }),
  }
}

export const useBillSplitterStore = Object.assign(useBillSplitterStoreImpl, {
  getState: () => useLocalBillSplitterStore.getState(),
  setState: (partial: Partial<BillSplitterState>) => useLocalBillSplitterStore.setState(partial),
})
