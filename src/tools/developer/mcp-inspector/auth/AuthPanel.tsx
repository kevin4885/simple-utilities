import { useId, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Profile } from '../schemas'
import { getSecret } from '../secrets'
import { oauthSecretKey } from './callback'
import { OAUTH_CREDENTIALS_EVENT, oauthRedirectUrl, tokenStatus } from './logic'
import { clearOAuthCredentials } from './provider'

function subscribe(onChange: () => void): () => void {
  window.addEventListener(OAUTH_CREDENTIALS_EVENT, onChange)
  return () => window.removeEventListener(OAUTH_CREDENTIALS_EVENT, onChange)
}

/**
 * Sidebar section for a profile's authentication: none or OAuth, scope, an optional pre-registered
 * client ID, the sign-in status and "Clear credentials". Token values are never rendered - only
 * whether tokens exist and when the access token expires.
 */
export default function AuthPanel({
  profile,
  onChange,
  disabled = false,
}: {
  profile: Profile
  onChange(patch: Partial<Pick<Profile, 'auth'>>): void
  disabled?: boolean
}) {
  const uid = useId()
  /** Profile the 'Credentials cleared' notice belongs to; null = none. */
  const [clearedFor, setClearedFor] = useState<string | null>(null)
  const profileId = profile.id
  const oauth = profile.auth.mode === 'oauth'
  const cleared = clearedFor === profileId

  // The stored token record is the source of truth: sign-in finishing, a token refresh and
  // 'Clear credentials' all announce themselves with OAUTH_CREDENTIALS_EVENT. Only whether tokens
  // exist and when they expire is derived from it; the string itself never reaches the markup.
  const stored = useSyncExternalStore(subscribe, () => getSecret(oauthSecretKey(profileId, 'tokens')))
  const status = tokenStatus(stored)

  const setAuth = (patch: Partial<Profile['auth']>) => onChange({ auth: { ...profile.auth, ...patch } })

  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        <Label id={`${uid}-mode`}>Authentication mode</Label>
        <Select
          value={profile.auth.mode}
          onValueChange={(v) => {
            setClearedFor(null)
            setAuth({ mode: v === 'oauth' ? 'oauth' : 'none' })
          }}
          disabled={disabled}
        >
          <SelectTrigger aria-labelledby={`${uid}-mode`} size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="oauth">OAuth</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {oauth && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-scope`}>Scope</Label>
            <Input
              id={`${uid}-scope`}
              value={profile.auth.scope ?? ''}
              onChange={(e) => setAuth({ scope: e.target.value === '' ? null : e.target.value })}
              placeholder="optional, e.g. mcp:tools"
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-client`}>Pre-registered client ID</Label>
            <Input
              id={`${uid}-client`}
              value={profile.auth.clientId ?? ''}
              onChange={(e) => setAuth({ clientId: e.target.value.trim() === '' ? null : e.target.value.trim() })}
              placeholder="optional"
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${uid}-client-help`}
            />
            <p id={`${uid}-client-help`} className="text-xs text-muted-foreground">
              Leave empty to register this app with the authorization server automatically. If the server does not
              support that, register a public client yourself with the redirect URI{' '}
              <code className="break-all">{oauthRedirectUrl(window.location.origin)}</code> and enter its ID here.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p role="status" className="text-xs">
              {status.signedIn ? (
                <>
                  <span className="font-medium">Signed in</span>
                  {status.expiresAt !== null && (
                    <span className="text-muted-foreground">
                      {' '}
                      · access token expiry {new Date(status.expiresAt).toLocaleString()}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">Not authorized</span>
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => {
                clearOAuthCredentials(profileId, 'all') // notifies, which refreshes the status line
                setClearedFor(profileId)
              }}
            >
              Clear credentials
            </Button>
          </div>
          {cleared && (
            <p role="status" className="text-xs text-muted-foreground">
              Credentials cleared
            </p>
          )}
        </>
      )}
    </div>
  )
}
