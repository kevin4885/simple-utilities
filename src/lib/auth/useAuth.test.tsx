/**
 * useAuth tests — the Supabase client and the import sweep's I/O module are
 * mocked so these exercise only useAuth's own state-derivation and
 * signOut-ordering logic, never a real network call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'

const onAuthStateChangeMock = vi.fn()
const signInWithOAuthMock = vi.fn()
const signOutMock = vi.fn()

vi.mock('../supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      signInWithOAuth: (...args: unknown[]) => signInWithOAuthMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
    },
  },
}))

const runImportSweepMock = vi.fn()
vi.mock('../cloudState/importSweep.io', () => ({
  runImportSweep: (...args: unknown[]) => runImportSweepMock(...args),
}))

// Imported after the mocks above so useAuth picks up the mocked modules.
const { AuthProvider, useAuth } = await import('./useAuth')

function makeSession(userId = 'user-1'): Session {
  return {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: userId,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '',
    },
  } as unknown as Session
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  )
}

let authChangeCallback: (event: string, session: Session | null) => void

beforeEach(() => {
  onAuthStateChangeMock.mockReset()
  signInWithOAuthMock.mockReset()
  signOutMock.mockReset().mockResolvedValue({ error: null })
  runImportSweepMock.mockReset().mockResolvedValue(undefined)

  onAuthStateChangeMock.mockImplementation((cb: typeof authChangeCallback) => {
    authChangeCallback = cb
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
})

describe('useAuth', () => {
  it('starts as signed-out with a null user once the initial (no-session) check resolves', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => {
      authChangeCallback('INITIAL_SESSION', null)
    })

    expect(result.current.user).toBeNull()
    expect(result.current.status).toBe('signed-out')
  })

  it('reflects a signed-in session: user is the session user, status is signed-in', () => {
    const session = makeSession('user-42')
    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => {
      authChangeCallback('INITIAL_SESSION', session)
    })

    expect(result.current.user).toEqual(session.user)
    expect(result.current.status).toBe('signed-in')
  })

  it('signInWithGoogle calls signInWithOAuth with the google provider and /app redirect', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => {
      result.current.signInWithGoogle()
    })

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app` },
    })
  })

  it('signOut calls supabase.auth.signOut() then queryClient.clear(), in that order', async () => {
    const callOrder: string[] = []
    signOutMock.mockImplementation(async () => {
      callOrder.push('signOut')
      return { error: null }
    })

    let queryClient!: QueryClient
    function CaptureClient({ children }: { children: ReactNode }) {
      const qc = useQueryClient()
      queryClient = qc
      vi.spyOn(qc, 'clear').mockImplementation(() => {
        callOrder.push('clear')
      })
      return <>{children}</>
    }
    function localWrapper({ children }: { children: ReactNode }) {
      const qc = new QueryClient()
      return (
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <CaptureClient>{children}</CaptureClient>
          </AuthProvider>
        </QueryClientProvider>
      )
    }

    const { result } = renderHook(() => useAuth(), { wrapper: localWrapper })

    await act(async () => {
      await result.current.signOut()
    })

    expect(callOrder).toEqual(['signOut', 'clear'])
    expect(queryClient).toBeDefined()
  })

  it('runs the import sweep exactly once on the SIGNED_IN event, not on every token refresh', async () => {
    const session = makeSession('user-7')
    renderHook(() => useAuth(), { wrapper })

    act(() => {
      authChangeCallback('SIGNED_IN', session)
    })
    await waitFor(() => expect(runImportSweepMock).toHaveBeenCalledTimes(1))
    expect(runImportSweepMock).toHaveBeenCalledWith('user-7')

    act(() => {
      authChangeCallback('TOKEN_REFRESHED', session)
    })
    expect(runImportSweepMock).toHaveBeenCalledTimes(1)
  })
})
