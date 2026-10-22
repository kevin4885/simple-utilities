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

// ── Lost-message buffer ──────────────────────────────────────────────────────
// `redirectToAuthorization` opens the popup, but `completeAuthorization` only starts listening after
// `connect()` has returned `auth-required`. A fast redirect can post its callback message in between,
// and a BroadcastChannel does not replay messages to listeners created later. So from the moment the
// popup opens, one module-level listener keeps the most recent callback message in a single slot
// until `completeAuthorization` takes it. Nothing is validated here: the taker checks `state`.
// The buffer stops (listener closed, slot cleared) when it is taken, on abort, when a new sign-in
// starts, and after 5 minutes.

let bufferChannel: BroadcastChannel | null = null
let bufferSlot: OAuthCallbackMessage | null = null
let bufferTimer: ReturnType<typeof setTimeout> | null = null

/** Closes the buffer's listener and empties its slot. Safe to call at any time. */
export function stopCallbackBuffer(): void {
  if (bufferTimer !== null) clearTimeout(bufferTimer)
  bufferTimer = null
  if (bufferChannel !== null) {
    bufferChannel.onmessage = null
    bufferChannel.close()
  }
  bufferChannel = null
  bufferSlot = null
}

/** Starts (or restarts) buffering. provider.ts calls this right after it opened the sign-in popup. */
export function startCallbackBuffer(): void {
  stopCallbackBuffer()
  if (typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(OAUTH_CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data
      if (isOAuthCallbackMessage(data)) bufferSlot = data
    }
    bufferChannel = channel
  } catch {
    return // no buffering; completeAuthorization still works for any redirect that is not faster than it
  }
  bufferTimer = setTimeout(stopCallbackBuffer, AUTH_TIMEOUT_MS)
}

/** Returns the buffered message (or null) and stops the buffer: the caller listens by itself from now on. */
function takeBufferedMessage(): OAuthCallbackMessage | null {
  const message = bufferSlot
  stopCallbackBuffer()
  return message
}

/**
 * Waits for the authorization response of the sign-in this session just started, verifies its
 * `state`, then calls `session.finishAuth(code, iss)` exactly once (`iss` is the RFC 9207 issuer
 * parameter of the response, passed through unchanged, or `undefined` when the response had none).
 *  - a response that arrived before this call (see the lost-message buffer above) is handled first;
 *  - resolves once finishAuth succeeded;
 *  - rejects with Error(message) on a provider error, a finishAuth failure or after 5 minutes of silence;
 *  - rejects with a DOMException named AbortError when `signal` aborts.
 * A response whose state does not match the pending attempt is ignored (a warn event is logged)
 * and the wait continues. The channel is closed in every case.
 */
export function completeAuthorization(session: McpSession, profileId: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      stopCallbackBuffer()
      reject(abortError())
      return
    }
    if (typeof BroadcastChannel === 'undefined') {
      stopCallbackBuffer()
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
    const onAbort = (): void => {
      stopCallbackBuffer()
      finish({ ok: false, error: abortError() })
    }

    const handle = (data: unknown): void => {
      if (settled) return
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
      const { code, iss } = data
      deleteSecret(stateKey)
      channel.onmessage = null
      channel.close()
      session
        .finishAuth(code, iss ?? undefined)
        .then(
          () => finish({ ok: true }),
          (e: unknown) => finish({ ok: false, error: new Error(authFailureMessage(e, { endpoint: 'token', origin: window.location.origin })) }),
        )
    }

    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(
      () => finish({ ok: false, error: new Error('Timed out waiting for authorization (5 minutes). Start the sign-in again.') }),
      AUTH_TIMEOUT_MS,
    )

    channel.onmessage = (event: MessageEvent) => handle(event.data)
    // The buffer's listener is replaced by this one; whatever it caught while nobody was waiting is handled now.
    const early = takeBufferedMessage()
    if (early !== null) handle(early)
  })
}
/**
 * Full-page-redirect fallback: reads AND clears the `oauth:pending-return` marker. Returns the
 * profile, code, state and RFC 9207 `iss` (string or null) only when the marker holds a complete response whose `state` matches the
 * attempt this browser tab started; anything else (an abandoned redirect, a provider error, a
 * forged or stale state) returns null. A provider error is surfaced as a log event.
 */
export function consumePendingOAuthReturn(): { profileId: string; code: string; state: string; iss: string | null } | null {
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

  // RFC 9207 `iss`: string or null. Anything else means the marker is not ours - drop it.
  if (marker.iss !== undefined && marker.iss !== null && typeof marker.iss !== 'string') return null
  const iss = typeof marker.iss === 'string' && marker.iss ? marker.iss : null
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
  return { profileId, code, state, iss }
}
