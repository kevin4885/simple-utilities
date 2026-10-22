import type { McpSession } from '../connection/session'
import { deleteSecret, getSecret } from '../secrets'
import { useLogStore } from '../shell/logStore'
import {
  OAUTH_CHANNEL,
  PENDING_RETURN_KEY,
  isOAuthCallbackMessage,
  oauthSecretKey,
  validateState,
  type OAuthCallbackMessage,
} from './callback'
import { authFailureMessage } from './logic'

// The two ways an authorization response gets back to the tool:
//  - popup (default): the callback route posts one message on a same-origin BroadcastChannel and
//    `completeAuthorization` (waiting since sign-in began) verifies `state` and finishes the flow;
//  - full-page fallback (popup blocked): the callback route leaves the response in the session-only
//    `oauth:pending-return` marker and navigates back; `consumePendingOAuthReturn` verifies it on load.
// In both, `state` is the per-attempt value provider.ts stored; it is single-use.

export const AUTH_TIMEOUT_MS = 5 * 60 * 1000

function logWarn(text: string): void {
  useLogStore.getState().append({ ts: Date.now(), kind: 'event', level: 'warn', text })
}

function abortError(): DOMException {
  return new DOMException('Authorization cancelled', 'AbortError')
}

function describeCallbackError(message: OAuthCallbackMessage): string {
  const code = message.error ?? 'unknown_error'
  return message.errorDescription ? `${code}: ${message.errorDescription}` : code
}

/**
 * Waits for the authorization response of the sign-in this session just started, verifies its
 * `state`, then calls `session.finishAuth(code)` exactly once.
 *  - resolves once finishAuth succeeded;
 *  - rejects with Error(message) on a provider error, a finishAuth failure or after 5 minutes of silence;
 *  - rejects with a DOMException named AbortError when `signal` aborts.
 * A response whose state does not match the pending attempt is ignored (a warn event is logged)
 * and the wait continues. The channel is closed in every case.
 */
export function completeAuthorization(session: McpSession, profileId: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    if (typeof BroadcastChannel === 'undefined') {
      reject(new Error('This browser does not support BroadcastChannel, which the sign-in popup needs.'))
      return
    }

    const channel = new BroadcastChannel(OAUTH_CHANNEL)
    const stateKey = oauthSecretKey(profileId, 'state')
    let settled = false

    const finish = (outcome: { ok: true } | { ok: false; error: unknown }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer) // assigned below; finish() only ever runs after that
      signal.removeEventListener('abort', onAbort)
      channel.onmessage = null
      channel.close()
      if (outcome.ok) resolve()
      else reject(outcome.error)
    }
    const onAbort = (): void => finish({ ok: false, error: abortError() })

    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(
      () => finish({ ok: false, error: new Error('Timed out waiting for authorization (5 minutes). Start the sign-in again.') }),
      AUTH_TIMEOUT_MS,
    )

    channel.onmessage = (event: MessageEvent) => {
      if (settled) return
      const data: unknown = event.data
      if (!isOAuthCallbackMessage(data)) return
      const expected = getSecret(stateKey)
      const stateOk = validateState(expected, data.state)

      if (data.error !== null) {
        // RFC 6749 4.1.2.1: an error response echoes `state` when the request had one. A response that
        // carries a different state belongs to another attempt; one without any state is accepted.
        if (data.state !== null && !stateOk) {
          logWarn('Ignored an authorization response whose state does not match this sign-in.')
          return
        }
        deleteSecret(stateKey)
        finish({ ok: false, error: new Error(describeCallbackError(data)) })
        return
      }

      if (!stateOk) {
        logWarn('Ignored an authorization response whose state does not match this sign-in.')
        return
      }
      if (data.code === null) return

      // A matching response: single-use state, then redeem the code. Stay abortable while that runs.
      const code = data.code
      deleteSecret(stateKey)
      channel.onmessage = null
      channel.close()
      session
        .finishAuth(code)
        .then(
          () => finish({ ok: true }),
          (e: unknown) => finish({ ok: false, error: new Error(authFailureMessage(e, { endpoint: 'token', origin: window.location.origin })) }),
        )
    }
  })
}

/**
 * Full-page-redirect fallback: reads AND clears the `oauth:pending-return` marker. Returns the
 * profile, code and state only when the marker holds a complete response whose `state` matches the
 * attempt this browser tab started; anything else (an abandoned redirect, a provider error, a
 * forged or stale state) returns null. A provider error is surfaced as a log event.
 */
export function consumePendingOAuthReturn(): { profileId: string; code: string; state: string } | null {
  const raw = getSecret(PENDING_RETURN_KEY)
  if (raw === null) return null
  deleteSecret(PENDING_RETURN_KEY)

  let marker: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    marker = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const profileId = typeof marker.profileId === 'string' && marker.profileId ? marker.profileId : null
  if (!profileId) return null

  const stateKey = oauthSecretKey(profileId, 'state')
  const expected = getSecret(stateKey)
  const state = typeof marker.state === 'string' ? marker.state : null

  if (typeof marker.error === 'string' && marker.error) {
    // Same rule as the popup path: an error with a state must match this attempt.
    if (state !== null && !validateState(expected, state)) return null
    deleteSecret(stateKey)
    const description = typeof marker.errorDescription === 'string' && marker.errorDescription ? `: ${marker.errorDescription}` : ''
    useLogStore.getState().append({ ts: Date.now(), kind: 'event', level: 'error', text: `Authorization failed: ${marker.error}${description}` })
    return null
  }

  const code = typeof marker.code === 'string' && marker.code ? marker.code : null
  if (!code || !state) return null // marker written before the redirect and never completed
  if (!validateState(expected, state)) {
    useLogStore.getState().append({
      ts: Date.now(),
      kind: 'event',
      level: 'warn',
      text: 'Ignored a returned authorization response whose state does not match this sign-in.',
    })
    return null
  }
  deleteSecret(stateKey)
  return { profileId, code, state }
}
