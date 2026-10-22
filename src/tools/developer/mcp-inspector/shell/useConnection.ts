import { useCallback, useEffect, useRef, useState } from 'react'
import { buildAuthProvider } from '../auth/provider'
import { completeAuthorization, consumePendingOAuthReturn } from '../auth/flow'
import { clientFeatureSetup } from '../client-features/register'
import { errorMessage } from '../connection/logic'
import { createSession, type McpSession } from '../connection/session'
import type { ConnectionConfig, ServerSummary, SessionOptions, SessionState } from '../connection/types'
import type { Profile } from '../schemas'
import { getSecret } from '../secrets'
import { useMcpInspectorStore } from '../store'
import { localDiagnosis, profileToConfig } from './logic'
import { useLogStore } from './logStore'

export type SessionBaseOptions = Omit<SessionOptions, 'onLog' | 'onState'>

export interface UseConnectionResult {
  state: SessionState
  /** The connected session, else null. Never cache it across reconnects (see `epoch`). */
  session: McpSession | null
  info: ServerSummary | null
  /** Increments on every successful connect, so views keyed by it never hold a stale `session.client`. */
  epoch: number
  /** The options the live session was built from (for tabs that open throwaway sessions). */
  sessionOptions: SessionBaseOptions | null
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Aborts a pending "waiting for authorization" and ends Disconnected. */
  cancelAuth(): Promise<void>
}

interface Live {
  session: McpSession
  options: SessionBaseOptions
  profileId: string
}

interface PendingReturn {
  profileId: string
  code: string
  state: string
  iss: string | null
}

function logEvent(level: 'info' | 'warn' | 'error', text: string): void {
  useLogStore.getState().append({ ts: Date.now(), kind: 'event', level, text })
}

function authFailure(detail: string) {
  return localDiagnosis('unauthorized', 'Authorization failed', detail, [
    'Check the OAuth settings of this profile and try again.',
    'If a popup was blocked, allow popups for this site and retry.',
  ])
}

/**
 * Owns one MCP session for the active profile: connect / disconnect, the OAuth wait-and-retry
 * loop, and the cleanup rules (switching profile or unmounting disconnects first).
 * A new session is created on every user-initiated connect so edits to the profile (and fresh
 * secrets) are always picked up; the OAuth retry reuses the same session.
 */
export function useConnection(
  profile: Profile | null,
  deps: { createSessionFn?: typeof createSession } = {},
): UseConnectionResult {
  // Captured once: an inline stub in the caller must not re-create the callbacks below on every render.
  const [createSessionFn] = useState(() => deps.createSessionFn ?? createSession)
  const [state, setState] = useState<SessionState>({ status: 'disconnected' })
  const [live, setLive] = useState<Live | null>(null)
  const [epoch, setEpoch] = useState(0)

  const liveRef = useRef<Live | null>(null)
  const authAbortRef = useRef<AbortController | null>(null)
  /** Bumped whenever a new session is created or the hook unmounts; callbacks of older sessions go quiet. */
  const tokenRef = useRef(0)
  const invalidateCallbacks = useCallback(() => {
    tokenRef.current += 1
  }, [])

  const closeLive = useCallback(async () => {
    authAbortRef.current?.abort()
    authAbortRef.current = null
    const l = liveRef.current
    liveRef.current = null
    if (!l) return
    await l.session.disconnect()
    setLive((cur) => (cur === l ? null : cur))
  }, [])

  const openSession = useCallback(
    (p: Profile, config: ConnectionConfig) => {
      const token = ++tokenRef.current
      const options: SessionBaseOptions = {
        config,
        authProvider: buildAuthProvider(p, window.location.origin),
        clientSetup: clientFeatureSetup,
      }
      const session = createSessionFn({
        ...options,
        onLog: (e) => useLogStore.getState().append(e),
        onState: (s) => {
          if (tokenRef.current !== token) return
          setState(s)
          if (s.status === 'connected') setEpoch((n) => n + 1)
        },
      })
      const l: Live = { session, options, profileId: p.id }
      liveRef.current = l
      setLive(l)
      return { live: l, token }
    },
    [createSessionFn],
  )

  /** connect() -> (auth-required -> wait for authorization -> connect() once more). */
  const run = useCallback(async (l: Live, token: number) => {
    const stale = () => tokenRef.current !== token
    const first = await l.session.connect()
    if (stale() || first.status !== 'auth-required') return

    const ac = new AbortController()
    authAbortRef.current = ac
    try {
      await completeAuthorization(l.session, l.profileId, ac.signal)
    } catch (e) {
      if (ac.signal.aborted || stale()) return
      const message = errorMessage(e)
      logEvent('error', `Authorization failed: ${message}`)
      setState({ status: 'error', diagnosis: authFailure(message) })
      return
    } finally {
      if (authAbortRef.current === ac) authAbortRef.current = null
    }
    if (stale() || ac.signal.aborted) return

    const second = await l.session.connect()
    if (stale()) return
    if (second.status === 'auth-required') {
      setState({
        status: 'error',
        diagnosis: authFailure('The server still requires authorization after sign-in completed.'),
      })
    }
  }, [])

  const connect = useCallback(async () => {
    if (!profile) return
    await closeLive()
    const { config, invalid } = profileToConfig(profile, getSecret)
    if (invalid.length > 0) {
      setState({
        status: 'error',
        diagnosis: localDiagnosis('unknown', 'Invalid header name', `Fix these header names first: ${invalid.join(', ')}`),
      })
      return
    }
    const { live: l, token } = openSession(profile, config)
    await run(l, token)
  }, [profile, closeLive, openSession, run])

  const disconnect = useCallback(async () => {
    await closeLive()
    if (liveRef.current === null) setState({ status: 'disconnected' })
  }, [closeLive])

  const cancelAuth = useCallback(async () => {
    if (!authAbortRef.current) return
    logEvent('info', 'Authorization cancelled')
    await closeLive()
    if (liveRef.current === null) setState({ status: 'disconnected' })
  }, [closeLive])

  /** Full-page OAuth fallback: the browser came back from the authorization server. */
  const resumeAfterRedirect = useCallback(
    async (pending: PendingReturn) => {
      const target = useMcpInspectorStore.getState().profiles.find((p) => p.id === pending.profileId)
      if (!target) {
        setState({
          status: 'error',
          diagnosis: localDiagnosis(
            'unknown',
            'Authorization could not be resumed',
            'The profile this sign-in belonged to no longer exists.',
          ),
        })
        return
      }
      await closeLive()
      useMcpInspectorStore.getState().setActiveProfile(target.id)
      const { live: l, token } = openSession(target, profileToConfig(target, getSecret).config)
      setState({ status: 'connecting' })
      try {
        await l.session.finishAuth(pending.code, pending.iss ?? undefined)
      } catch (e) {
        if (tokenRef.current !== token) return
        const message = errorMessage(e)
        logEvent('error', `Authorization failed: ${message}`)
        setState({ status: 'error', diagnosis: authFailure(message) })
        return
      }
      if (tokenRef.current !== token) return
      await run(l, token)
    },
    [closeLive, openSession, run],
  )

  // On mount: pick up a full-page OAuth return. Deferred a tick so React StrictMode's
  // simulated unmount/remount cannot tear down the session this creates.
  useEffect(() => {
    const t = setTimeout(() => {
      const pending = consumePendingOAuthReturn()
      if (pending) void resumeAfterRedirect(pending)
    }, 0)
    return () => clearTimeout(t)
  }, [resumeAfterRedirect])

  // Switching profile (or deleting the active one) disconnects the old session first.
  const profileId = profile?.id ?? null
  useEffect(() => {
    const l = liveRef.current
    if (l && l.profileId !== profileId) void closeLive().then(() => {
        // A connect() on the new profile may already be under way; do not clobber its state.
        if (liveRef.current === null) setState({ status: 'disconnected' })
      })
  }, [profileId, closeLive])

  // Unmount: stop waiting for authorization and disconnect.
  useEffect(() => {
    return () => {
      invalidateCallbacks()
      authAbortRef.current?.abort()
      const l = liveRef.current
      liveRef.current = null
      void l?.session.disconnect()
    }
  }, [invalidateCallbacks])

  const connected = state.status === 'connected'
  return {
    state,
    session: connected && live ? live.session : null,
    info: state.status === 'connected' ? state.info : null,
    epoch,
    sessionOptions: connected && live ? live.options : null,
    connect,
    disconnect,
    cancelAuth,
  }
}
