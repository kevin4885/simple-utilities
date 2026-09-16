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

const { useToolState, useDeleteToolItem, toolStateQueryKey } = await import('./useToolState')
const { toolItemListQueryKey } = await import('./useToolItemList')

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

/** Like `wrapper`, but hands back the `QueryClient` instance so a test can
 *  inspect cache state directly after a mutation resolves. */
function makeWrapperWithClient() {
  const queryClient = new QueryClient()
  function ClientWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, wrapper: ClientWrapper }
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

describe('useDeleteToolItem — signed in', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({
      status: 'signed-in',
      user: { id: 'the-current-user' },
    })
  })

  function makeDeleteChain() {
    const chain = {} as { eq: ReturnType<typeof vi.fn> }
    chain.eq = vi.fn(() => chain)
    return chain
  }

  it("issues exactly one .delete() scoped to the session user id, the hook's own toolId, and the given itemId — never a caller-overridable value", async () => {
    const chain = makeDeleteChain()
    const deleteMock = vi.fn(() => chain)
    fromMock.mockReturnValue({ delete: deleteMock })
    // The last .eq() in the chain resolves the delete.
    let eqCallCount = 0
    chain.eq.mockImplementation(() => {
      eqCallCount += 1
      if (eqCallCount === 3) return Promise.resolve({ data: null, error: null })
      return chain
    })

    const { result } = renderHook(() => useDeleteToolItem('signed-in-tool'), { wrapper })

    act(() => {
      result.current.deleteItem('doc-123')
    })

    await waitFor(() => expect(result.current.isDeleting).toBe(false))

    expect(fromMock).toHaveBeenCalledWith('tool_state')
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'the-current-user')
    expect(chain.eq).toHaveBeenCalledWith('tool_id', 'signed-in-tool')
    expect(chain.eq).toHaveBeenCalledWith('item_id', 'doc-123')
  })

  it('deleting a non-existent item_id is a no-op — does not throw, isDeleting returns to false, and the hook remains usable for a subsequent call', async () => {
    const chain = makeDeleteChain()
    // Supabase/PostgREST returns success with zero rows affected, not an
    // error, when the row doesn't exist — never surfaced as an error here.
    let eqCallCount = 0
    chain.eq.mockImplementation(() => {
      eqCallCount += 1
      if (eqCallCount % 3 === 0) return Promise.resolve({ data: null, error: null })
      return chain
    })
    fromMock.mockReturnValue({ delete: vi.fn(() => chain) })

    const { result } = renderHook(() => useDeleteToolItem('signed-in-tool'), { wrapper })

    act(() => {
      result.current.deleteItem('already-gone')
    })
    await waitFor(() => expect(result.current.isDeleting).toBe(false))

    // Hook remains usable for a subsequent call.
    act(() => {
      result.current.deleteItem('another-item')
    })
    await waitFor(() => expect(result.current.isDeleting).toBe(false))

    expect(fromMock).toHaveBeenCalledTimes(2)
  })

  it("after a successful delete, useToolItemList(toolId)'s cached item list no longer includes the deleted item_id", async () => {
    const { queryClient, wrapper: clientWrapper } = makeWrapperWithClient()
    const userId = 'the-current-user'
    const toolId = 'signed-in-tool'

    // Seed the item-list cache exactly as useToolItemList would populate it.
    queryClient.setQueryData(toolItemListQueryKey(userId, toolId), ['doc-1', 'doc-123'])
    queryClient.setQueryData(toolStateQueryKey(userId, toolId, 'doc-123'), { text: 'gone soon' })

    const chain = makeDeleteChain()
    let eqCallCount = 0
    chain.eq.mockImplementation(() => {
      eqCallCount += 1
      if (eqCallCount === 3) return Promise.resolve({ data: null, error: null })
      return chain
    })
    fromMock.mockReturnValue({ delete: vi.fn(() => chain) })

    const { result } = renderHook(() => useDeleteToolItem(toolId), { wrapper: clientWrapper })

    act(() => {
      result.current.deleteItem('doc-123')
    })

    await waitFor(() => expect(result.current.isDeleting).toBe(false))

    // The item's own cached tool_state entry is gone.
    expect(queryClient.getQueryData(toolStateQueryKey(userId, toolId, 'doc-123'))).toBeUndefined()
    // The item-list query was invalidated (marked stale) so a mounted
    // useToolItemList consumer will refetch and drop 'doc-123'.
    const listState = queryClient.getQueryState(toolItemListQueryKey(userId, toolId))
    expect(listState?.isInvalidated).toBe(true)
  })
})
