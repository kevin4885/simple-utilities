import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { PENDING_RETURN_KEY, OAUTH_CHANNEL, TOOL_PATH, parseCallbackParams, toCallbackMessage } from './callback'
import { deleteSecret, getSecret, setSecret } from '../secrets'

// The `/oauth/callback` route. It must stay tiny: it imports callback.ts and secrets.ts ONLY - never
// the MCP SDK (see callback.test.ts, which checks the import graph). It never renders the code.

const MAX_SHOWN_ERROR = 300
const STORAGE_ERROR = 'Browser storage is unavailable, so the sign-in could not be handed back to the tool.'

/** The sign-in marker written by redirectToAuthorization when the popup was blocked, or null. */
function readPendingProfileId(): string | null {
  const raw = getSecret(PENDING_RETURN_KEY)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    const id = typeof parsed === 'object' && parsed !== null ? (parsed as { profileId?: unknown }).profileId : undefined
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

export default function OAuthCallbackPage() {
  const navigate = useNavigate()
  const handled = useRef(false)
  // Read once, during the first render: the effect below removes the response from the address bar.
  const [params] = useState(() => parseCallbackParams(window.location.search))
  const [pendingProfileId] = useState(readPendingProfileId)
  const [storageFailed, setStorageFailed] = useState(false)

  // No `code` and no `error` (someone opened the URL by hand) is not a success either.
  const failed = params.error !== null || params.code === null
  const failureText = [params.error, params.errorDescription].filter(Boolean).join(': ') || 'No authorization code was returned.'

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  useEffect(() => {
    // StrictMode runs effects twice in dev; the response must be delivered exactly once.
    if (handled.current) return
    handled.current = true

    // Take the response out of the address bar/history before anything else happens.
    window.history.replaceState(null, '', window.location.pathname)

    if (pendingProfileId !== null) {
      // Full-page fallback: this window IS the tool's window (no popup was opened). Hand the response to
      // the tool through the session-only marker and go back to it.
      const stored = setSecret(
        PENDING_RETURN_KEY,
        JSON.stringify({
          profileId: pendingProfileId,
          code: params.code,
          state: params.state,
          iss: params.iss,
          error: params.error,
          errorDescription: params.errorDescription,
        }),
        { persist: false },
      )
      if (stored) {
        navigate(TOOL_PATH, { replace: true })
      } else {
        deleteSecret(PENDING_RETURN_KEY)
        queueMicrotask(() => setStorageFailed(true))
      }
      return
    }

    // Popup flow: one message to the tool window, then get out of the way.
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(OAUTH_CHANNEL)
      channel.postMessage(toCallbackMessage(params))
      channel.close()
    }
    window.close()
  }, [navigate, params, pendingProfileId])

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-2 bg-background p-6 text-center text-foreground">
      {storageFailed ? (
        <>
          <p className="text-lg font-medium">Authorization was not completed - you can close this window</p>
          <p className="text-sm text-muted-foreground">{STORAGE_ERROR}</p>
        </>
      ) : pendingProfileId !== null ? (
        <p className="text-muted-foreground">Returning to the MCP Inspector…</p>
      ) : failed ? (
        <>
          <p className="text-lg font-medium">Authorization was not completed - you can close this window</p>
          <p className="text-sm text-muted-foreground">{failureText.slice(0, MAX_SHOWN_ERROR)}</p>
        </>
      ) : (
        <p className="text-lg font-medium">Authorization complete - you can close this window</p>
      )}
    </main>
  )
}
