/**
 * useToolState tests.
 *
 * Signed-out path uses the hook's real internal Zustand `persist` store
 * (no mocking of zustand/localStorage) — this is the "real, non-mocked
 * simple tool store" acceptance criterion: `setData` updates what `data`
 * returns, and the Supabase client is never touched.
 *
 * Signed-in path mocks `useAuth` (to force a signed-in session) and the
 * Supabase client module, then asserts every query/upsert call is scoped to
 * the mocked session's user id and the hook's own toolId/itemId params —
 * never any other value — and that an invalid row falls back to
 * `defaultValue` without throwing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { z } from 'zod'

const useAuthMock = vi.fn()
vi.mock('../auth/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

const fromMock = vi.fn()
vi.mock('../supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

const { useToolState } = await import('./useToolState')

const Schema = z.object({ text: z.string() })
const defaultValue = { text: '' }

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

beforeEach(() => {
  useAuthMock.mockReset()
  fromMock.mockReset()
  window.localStorage.clear()
})

describe('useToolState — signed out', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ status: 'signed-out', user: null })
  })

  it('setData updates what data returns, via the real Zustand store, with no Supabase call', () => {
    const { result } = renderHook(
      () => useToolState('signed-out-tool', 'default', Schema, defaultValue),
      { wrapper },
    )

    expect(result.current.data).toEqual(defaultValue)
    expect(result.current.isLoading).toBe(false)

    act(() => {
      result.current.setData({ text: 'hello world' })
    })

    expect(result.current.data).toEqual({ text: 'hello world' })
    expect(fromMock).not.toHaveBeenCalled()
  })
})

describe('useToolState — signed in', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({
      status: 'signed-in',
      user: { id: 'the-current-user' },
    })
  })

  it('scopes the read query to the session user id and the hook\'s own toolId/itemId', async () => {
    const chain = makeChain()
    chain.maybeSingle.mockResolvedValue({ data: { data: { text: 'from cloud' } }, error: null })
    fromMock.mockReturnValue({ select: vi.fn(() => chain), upsert: vi.fn() })

    const { result } = renderHook(
      () => useToolState('signed-in-tool', 'default', Schema, defaultValue),
      { wrapper },
    )

    await waitFor(() => expect(result.current.data).toEqual({ text: 'from cloud' }))

    expect(fromMock).toHaveBeenCalledWith('tool_state')
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'the-current-user')
    expect(chain.eq).toHaveBeenCalledWith('tool_id', 'signed-in-tool')
    expect(chain.eq).toHaveBeenCalledWith('item_id', 'default')
  })

  it('setData upserts a row scoped to the session user id and the hook\'s own toolId/itemId — never a caller-supplied value', async () => {
    const chain = makeChain()
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    fromMock.mockReturnValue({ select: vi.fn(() => chain), upsert: upsertMock })

    const { result } = renderHook(
      () => useToolState('signed-in-tool-2', 'doc-1', Schema, defaultValue),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.setData({ text: 'new content' })
    })

    await waitFor(() =>
      expect(upsertMock).toHaveBeenCalledWith({
        user_id: 'the-current-user',
        tool_id: 'signed-in-tool-2',
        item_id: 'doc-1',
        data: { text: 'new content' },
      }),
    )
  })

  it('falls back to defaultValue (never throws) when the cloud row fails schema validation', async () => {
    const chain = makeChain()
    chain.maybeSingle.mockResolvedValue({ data: { data: { wrong: 'shape' } }, error: null })
    fromMock.mockReturnValue({ select: vi.fn(() => chain), upsert: vi.fn() })

    const { result } = renderHook(
      () => useToolState('signed-in-tool-3', 'default', Schema, defaultValue),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual(defaultValue)
  })

  it('falls back to defaultValue (never throws) when no cloud row exists yet', async () => {
    const chain = makeChain()
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    fromMock.mockReturnValue({ select: vi.fn(() => chain), upsert: vi.fn() })

    const { result } = renderHook(
      () => useToolState('signed-in-tool-4', 'default', Schema, defaultValue),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual(defaultValue)
  })
})
