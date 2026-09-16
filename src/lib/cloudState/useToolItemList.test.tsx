/**
 * useToolItemList tests — mirrors useToolState.test.tsx's mocking approach
 * (mocked useAuth + mocked Supabase client).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

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

const { useToolItemList } = await import('./useToolItemList')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

beforeEach(() => {
  useAuthMock.mockReset()
  fromMock.mockReset()
})

describe('useToolItemList — signed out', () => {
  it('returns an empty list, no Supabase call', () => {
    useAuthMock.mockReturnValue({ status: 'signed-out', user: null })
    const { result } = renderHook(() => useToolItemList('markdown-editor'), { wrapper })

    expect(result.current.itemIds).toEqual([])
    expect(result.current.isLoading).toBe(false)
    expect(fromMock).not.toHaveBeenCalled()
  })
})

describe('useToolItemList — signed in', () => {
  it('scopes the query to the session user id and the given toolId, returning the item ids found', async () => {
    useAuthMock.mockReturnValue({ status: 'signed-in', user: { id: 'the-current-user' } })
    const eqMock = vi.fn()
    const chain = { eq: eqMock }
    eqMock.mockImplementation(() => chain)
    fromMock.mockReturnValue({
      select: vi.fn(() => chain),
    })
    // The second .eq() call must resolve the chain (thenable) to the rows.
    let callCount = 0
    eqMock.mockImplementation(() => {
      callCount += 1
      if (callCount === 2) {
        return Promise.resolve({ data: [{ item_id: 'doc-1' }, { item_id: 'doc-2' }], error: null })
      }
      return chain
    })

    const { result } = renderHook(() => useToolItemList('markdown-editor'), { wrapper })

    await waitFor(() => expect(result.current.itemIds).toEqual(['doc-1', 'doc-2']))
    expect(fromMock).toHaveBeenCalledWith('tool_state')
    expect(eqMock).toHaveBeenCalledWith('user_id', 'the-current-user')
    expect(eqMock).toHaveBeenCalledWith('tool_id', 'markdown-editor')
  })
})
