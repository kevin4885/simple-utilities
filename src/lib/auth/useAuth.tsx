/**
 * useAuth — Google-sign-in auth context/hook, wrapping Supabase Auth.
 *
 * Exposes `{ user, status, signInWithGoogle, signOut }`. `status` is
 * `'loading'` until the initial session check resolves, then `'signed-out'`
 * or `'signed-in'`. Every consumer (`useToolState`, `Header`, the import
 * sweep) reads this single context instance — there is exactly one
 * `onAuthStateChange` subscription for the whole app, set up by
 * `AuthProvider`.
 *
 * Import sweep: on Supabase's `SIGNED_IN` event specifically (not any
 * session-present check, so it never re-fires on a token refresh), runs the
 * one-time, idempotent, existence-check-based local→cloud import — see
 * `../cloudState/importSweep.io.ts`.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase/client'
import { runImportSweep } from '../cloudState/importSweep.io'

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

export interface AuthContextValue {
  user: User | null
  status: AuthStatus
  signInWithGoogle: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  status: 'loading',
  signInWithGoogle: () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const queryClient = useQueryClient()
  // Guards the import sweep so it fires at most once per SIGNED_IN event
  // callback invocation without overlapping a prior in-flight sweep — the
  // sweep's own logic is idempotent regardless, this just avoids redundant
  // concurrent network calls if SIGNED_IN somehow fired twice in a row.
  const sweepInFlightRef = useRef(false)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      setStatus(session?.user ? 'signed-in' : 'signed-out')

      if (event === 'SIGNED_IN' && session?.user && !sweepInFlightRef.current) {
        sweepInFlightRef.current = true
        void runImportSweep(session.user.id).finally(() => {
          sweepInFlightRef.current = false
        })
      }
    })

    return () => {
      sub.subscription.unsubscribe()
    }
  }, [])

  function signInWithGoogle() {
    void supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app` },
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
    queryClient.clear()
  }

  return (
    <AuthContext.Provider value={{ user, status, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
