/**
 * uuid-generator/store.test.ts
 *
 * Signed-in cloud-path coverage (Phase 3 of google-auth-cloud-state — one of
 * the 3+ tools with an explicit signed-in-mocked-session test per that
 * phase's acceptance criteria). Mirrors `useToolState.test.tsx`'s own
 * mocking approach.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { mergePersisted, useUuidGeneratorStore } from './store'
import type { UuidGeneratorState } from './store'

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

function makeCurrentState(overrides: Partial<UuidGeneratorState> = {}): UuidGeneratorState {
  return {
    idType: 'uuidv4',
    count: 1,
    casing: 'lower',
    hyphens: true,
    nanoIdLength: 21,
    setIdType: () => {},
    setCount: () => {},
    setCasing: () => {},
    setHyphens: () => {},
    setNanoIdLength: () => {},
    ...overrides,
  }
}

describe('mergePersisted', () => {
  it('returns current unchanged for corrupt input', () => {
    const current = makeCurrentState()
    expect(mergePersisted('garbage', current)).toBe(current)
  })

  it('merges valid partial state onto current', () => {
    const current = makeCurrentState()
    const merged = mergePersisted({ idType: 'ulid', count: 5 }, current)
    expect(merged.idType).toBe('ulid')
    expect(merged.count).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// useUuidGeneratorStore — signed in (cloud-backed path)
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
const TOOL_ID = 'uuid-generator'

describe('useUuidGeneratorStore — signed in', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ status: 'signed-in', user: { id: USER_ID } })
  })

  it("setData (setIdType) upserts exactly one row scoped to this tool's tool_id + 'default' + the current user id", async () => {
    const chain = makeChain()
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    fromMock.mockReturnValue({ select: vi.fn(() => chain), upsert: upsertMock })

    const { result } = renderHook(() => useUuidGeneratorStore(), { wrapper })

    await waitFor(() => expect(result.current.idType).toBe('uuidv4'))

    act(() => {
      result.current.setIdType('ulid')
    })

    await waitFor(() =>
      expect(upsertMock).toHaveBeenCalledWith({
        user_id: USER_ID,
        tool_id: TOOL_ID,
        item_id: 'default',
        data: {
          idType: 'ulid',
          count: 1,
          casing: 'lower',
          hyphens: true,
          nanoIdLength: 21,
        },
      }),
    )
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  it('a cloud row that fails schema validation falls back to the default value — never crashes', async () => {
    const chain = makeChain()
    chain.maybeSingle.mockResolvedValue({ data: { data: { count: 99999 } }, error: null })
    fromMock.mockReturnValue({ select: vi.fn(() => chain), upsert: vi.fn() })

    const { result } = renderHook(() => useUuidGeneratorStore(), { wrapper })

    await waitFor(() => expect(result.current.count).toBe(1))
    expect(result.current.idType).toBe('uuidv4')
  })
})
