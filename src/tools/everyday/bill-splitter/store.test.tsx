/**
 * BillSplitter store — mergePersisted tests
 *
 * Covers:
 *   – Corrupt / entirely invalid persisted state → returns current unchanged
 *   – Out-of-range field (people > 100) → returns current unchanged
 *   – Valid partial state merges onto current
 *   – Full valid state replaces current data fields
 *   – Missing fields from partial state keep current values
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { mergePersisted, useBillSplitterStore } from './store'
import type { BillSplitterState } from './store'

// ---------------------------------------------------------------------------
// Mocks for the signed-in describe block near the bottom of this file (Phase 3
// of google-auth-cloud-state — one of the 3+ tools with an explicit
// signed-in-mocked-session test per that phase's acceptance criteria).
// Mirrors `useToolState.test.tsx`'s own mocking approach.
// ---------------------------------------------------------------------------
const useAuthMock = vi.fn()
vi.mock('@/lib/auth/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

const fromMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

beforeEach(() => {
  useAuthMock.mockReset().mockReturnValue({ status: 'signed-out', user: null })
  fromMock.mockReset()
})

// Minimal stub of the current store state (setters are identity stubs for merge testing)
function makeCurrentState(overrides: Partial<BillSplitterState> = {}): BillSplitterState {
  return {
    billStr: '50.00',
    taxStr: '',
    tipPct: 18,
    tipOnPreTax: false,
    people: 2,
    roundUpMode: 'none',
    currency: 'USD',
    // stub setters
    setBillStr: () => {},
    setTaxStr: () => {},
    setTipPct: () => {},
    setTipOnPreTax: () => {},
    setPeople: () => {},
    setRoundUpMode: () => {},
    setCurrency: () => {},
    ...overrides,
  }
}

describe('mergePersisted', () => {
  it('returns current unchanged for null', () => {
    const current = makeCurrentState()
    expect(mergePersisted(null, current)).toBe(current)
  })

  it('returns current unchanged for undefined', () => {
    const current = makeCurrentState()
    expect(mergePersisted(undefined, current)).toBe(current)
  })

  it('returns current unchanged for non-object', () => {
    const current = makeCurrentState()
    expect(mergePersisted('corrupt', current)).toBe(current)
  })

  it('returns current unchanged when people is out of range (>100)', () => {
    const current = makeCurrentState()
    const persisted = { people: 999 }
    expect(mergePersisted(persisted, current)).toBe(current)
  })

  it('returns current unchanged when people is out of range (<1)', () => {
    const current = makeCurrentState()
    const persisted = { people: 0 }
    expect(mergePersisted(persisted, current)).toBe(current)
  })

  it('returns current unchanged when currency is unknown', () => {
    const current = makeCurrentState()
    const persisted = { currency: 'XYZ' }
    expect(mergePersisted(persisted, current)).toBe(current)
  })

  it('returns current unchanged when tipPct is out of range', () => {
    const current = makeCurrentState()
    const persisted = { tipPct: 300 } // max is 200
    expect(mergePersisted(persisted, current)).toBe(current)
  })

  it('merges valid partial state — only provided fields change', () => {
    const current = makeCurrentState()
    const persisted = { billStr: '120.00', people: 6 }
    const merged = mergePersisted(persisted, current)
    expect(merged.billStr).toBe('120.00')
    expect(merged.people).toBe(6)
    // unchanged fields
    expect(merged.tipPct).toBe(18)
    expect(merged.currency).toBe('USD')
    expect(merged.roundUpMode).toBe('none')
  })

  it('merges currency change', () => {
    const current = makeCurrentState()
    const persisted = { currency: 'EUR' }
    const merged = mergePersisted(persisted, current)
    expect(merged.currency).toBe('EUR')
    expect(merged.billStr).toBe('50.00')
  })

  it('merges roundUpMode change', () => {
    const current = makeCurrentState()
    const persisted = { roundUpMode: 'dollar' }
    const merged = mergePersisted(persisted, current)
    expect(merged.roundUpMode).toBe('dollar')
  })

  it('merges full valid persisted state', () => {
    const current = makeCurrentState()
    const persisted = {
      billStr: '200.00',
      taxStr: '20.00',
      tipPct: 15,
      tipOnPreTax: true,
      people: 8,
      roundUpMode: 'half',
      currency: 'GBP',
    }
    const merged = mergePersisted(persisted, current)
    expect(merged.billStr).toBe('200.00')
    expect(merged.taxStr).toBe('20.00')
    expect(merged.tipPct).toBe(15)
    expect(merged.tipOnPreTax).toBe(true)
    expect(merged.people).toBe(8)
    expect(merged.roundUpMode).toBe('half')
    expect(merged.currency).toBe('GBP')
  })

  it('preserves setter functions on merged state', () => {
    const current = makeCurrentState()
    const persisted = { billStr: '75.00' }
    const merged = mergePersisted(persisted, current)
    expect(typeof merged.setBillStr).toBe('function')
    expect(typeof merged.setPeople).toBe('function')
  })

  it('empty object persisted → all fields fall back to schema defaults', () => {
    const current = makeCurrentState({ billStr: '100.00', people: 5 })
    const merged = mergePersisted({}, current)
    // Empty object is valid partial — no fields to override, so current's values remain
    expect(merged.billStr).toBe('100.00')
    expect(merged.people).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// useBillSplitterStore — signed in (cloud-backed path)
// ---------------------------------------------------------------------------

interface Chain {
  eq: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
}

function makeChain(): Chain {
  const chain = {} as Chain
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn()
  return chain
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const USER_ID = 'the-current-user'
const TOOL_ID = 'bill-splitter'

describe('useBillSplitterStore — signed in', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ status: 'signed-in', user: { id: USER_ID } })
  })

  it("setData (setBillStr) upserts exactly one row scoped to this tool's tool_id + 'default' + the current user id", async () => {
    const chain = makeChain()
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    fromMock.mockReturnValue({ select: vi.fn(() => chain), upsert: upsertMock })

    const { result } = renderHook(() => useBillSplitterStore(), { wrapper })

    await waitFor(() => expect(result.current.billStr).toBe(''))

    act(() => {
      result.current.setBillStr('42.50')
    })

    await waitFor(() =>
      expect(upsertMock).toHaveBeenCalledWith({
        user_id: USER_ID,
        tool_id: TOOL_ID,
        item_id: 'default',
        data: {
          billStr: '42.50',
          taxStr: '',
          tipPct: 18,
          tipOnPreTax: false,
          people: 2,
          roundUpMode: 'none',
          currency: 'USD',
        },
      }),
    )
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  it('a cloud row that fails schema validation falls back to the default value — never crashes', async () => {
    const chain = makeChain()
    chain.maybeSingle.mockResolvedValue({ data: { data: { people: 999 } }, error: null })
    fromMock.mockReturnValue({ select: vi.fn(() => chain), upsert: vi.fn() })

    const { result } = renderHook(() => useBillSplitterStore(), { wrapper })

    await waitFor(() => expect(result.current.people).toBe(2))
    expect(result.current.billStr).toBe('')
  })
})
