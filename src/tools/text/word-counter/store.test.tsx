/**
 * word-counter/store.test.ts
 *
 * mergePersisted (rehydration) tests, plus signed-in cloud-path coverage
 * (Phase 3 of google-auth-cloud-state — one of the 3+ tools with explicit
 * signed-in-mocked-session tests per that phase's acceptance criteria).
 *
 * Mocking approach mirrors `useToolState.test.tsx` / markdown-editor's
 * `store.test.tsx`: mock `useAuth` and the Supabase client module, then
 * exercise the tool's own exported hook via `renderHook`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { mergePersisted, useWordCounterStore } from './store'
import type { WordCounterState } from './store'

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

const { registerSweepTargetMock } = vi.hoisted(() => ({ registerSweepTargetMock: vi.fn() }))
vi.mock('@/lib/cloudState/importSweep.io', () => ({
  registerSweepTarget: (...args: unknown[]) => registerSweepTargetMock(...args),
}))

beforeEach(() => {
  useAuthMock.mockReset().mockReturnValue({ status: 'signed-out', user: null })
  fromMock.mockReset()
})

function makeCurrentState(overrides: Partial<WordCounterState> = {}): WordCounterState {
  return {
    text: '',
    excludeStopwords: true,
    setText: () => {},
    setExcludeStopwords: () => {},
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
    const merged = mergePersisted({ text: 'hello' }, current)
    expect(merged.text).toBe('hello')
    expect(merged.excludeStopwords).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// useWordCounterStore — signed in (cloud-backed path)
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
const TOOL_ID = 'word-counter'

describe('useWordCounterStore — signed in', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ status: 'signed-in', user: { id: USER_ID } })
  })

  it("setData (setText) upserts exactly one row scoped to this tool's tool_id + 'default' + the current user id", async () => {
    const chain = makeChain()
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    fromMock.mockReturnValue({ select: vi.fn(() => chain), upsert: upsertMock })

    const { result } = renderHook(() => useWordCounterStore(), { wrapper })

    await waitFor(() => expect(result.current.text).toBe(''))

    act(() => {
      result.current.setText('hello world')
    })

    await waitFor(() =>
      expect(upsertMock).toHaveBeenCalledWith({
        user_id: USER_ID,
        tool_id: TOOL_ID,
        item_id: 'default',
        data: { text: 'hello world', excludeStopwords: true },
      }),
    )
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  it('a cloud row that fails schema validation falls back to the default value — never crashes', async () => {
    const chain = makeChain()
    chain.maybeSingle.mockResolvedValue({ data: { data: { text: 42, excludeStopwords: 'nope' } }, error: null })
    fromMock.mockReturnValue({ select: vi.fn(() => chain), upsert: vi.fn() })

    const { result } = renderHook(() => useWordCounterStore(), { wrapper })

    await waitFor(() => expect(result.current.text).toBe(''))
    expect(result.current.excludeStopwords).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Import-sweep registration (Phase 3b of google-auth-cloud-state)
// ---------------------------------------------------------------------------
describe('import-sweep registration', () => {
  it("registers a sweep target with the correct toolId and getLocalItems() reflecting the local store's current data", () => {
    expect(registerSweepTargetMock).toHaveBeenCalledTimes(1)
    const target = registerSweepTargetMock.mock.calls[0][0]
    expect(target.toolId).toBe('word-counter')

    useWordCounterStore.setState({ text: 'hello sweep', excludeStopwords: false })

    const items = target.getLocalItems()
    expect(items).toEqual([
      {
        itemId: 'default',
        data: expect.objectContaining({ text: 'hello sweep', excludeStopwords: false }),
      },
    ])
  })
})
