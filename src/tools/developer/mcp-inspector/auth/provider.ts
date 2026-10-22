import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import type { Profile } from '../schemas'
import { deleteSecret, getSecret, replaceSecret, setSecret } from '../secrets'
import { PENDING_RETURN_KEY, oauthSecretKey, type OAuthSecretKind } from './callback'
import { OAUTH_CREDENTIALS_EVENT, buildClientMetadata, oauthRedirectUrl, randomToken } from './logic'

// The SDK's OAuthClientProvider, backed by the two-tier secrets store (secrets.ts is the ONLY
// storage this file touches). Credentials (tokens, registered client) follow the profile's
// `persistSecrets` choice; everything transient (PKCE verifier, `state`, discovery state, the
// pending-return marker) is ALWAYS session-only.

export const POPUP_NAME = 'mcp-oauth'
const POPUP_FEATURES = 'popup,width=600,height=760'

export interface ProviderDeps {
  /** window.open; returns null when the popup was blocked. */
  openWindow?: (url: string, name: string, features: string) => Window | null
  /** location.assign - the full-page fallback. */
  assignLocation?: (url: string) => void
  now?: () => number
  /** Source of the `state` value; must return a fresh, unguessable string on every call. */
  newState?: () => string
}

function failIfNotStored(ok: boolean, what: string): void {
  if (!ok) throw new Error(`Could not store the OAuth ${what}: browser storage is unavailable or full.`)
}

function readJson<T extends object>(key: string): T | undefined {
  const raw = getSecret(key)
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as T) : undefined
  } catch {
    return undefined
  }
}

function notifyCredentialsChanged(): void {
  window.dispatchEvent(new Event(OAUTH_CREDENTIALS_EVENT))
}

export type InvalidationScope = 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'

/** Deletes one kind (or all) of a profile's stored OAuth state from BOTH secret tiers. Also used by the sidebar. */
export function clearOAuthCredentials(profileId: string, scope: InvalidationScope = 'all'): void {
  const kinds: OAuthSecretKind[] = scope === 'all' ? ['tokens', 'client', 'verifier', 'state', 'discovery'] : [scope]
  for (const kind of kinds) deleteSecret(oauthSecretKey(profileId, kind))
  notifyCredentialsChanged()
}

class McpOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: string
  private readonly persist: boolean
  private readonly openWindow: NonNullable<ProviderDeps['openWindow']>
  private readonly assignLocation: NonNullable<ProviderDeps['assignLocation']>
  private readonly now: () => number
  private readonly newState: () => string

  constructor(
    private readonly profile: Profile,
    origin: string,
    deps: ProviderDeps,
  ) {
    this.redirectUrl = oauthRedirectUrl(origin)
    this.persist = profile.persistSecrets
    this.openWindow = deps.openWindow ?? ((url, name, features) => window.open(url, name, features))
    this.assignLocation = deps.assignLocation ?? ((url) => window.location.assign(url))
    this.now = deps.now ?? Date.now
    this.newState = deps.newState ?? (() => randomToken(32))
  }

  private key(kind: OAuthSecretKind): string {
    return oauthSecretKey(this.profile.id, kind)
  }

  get clientMetadata(): OAuthClientMetadata {
    return buildClientMetadata({ redirectUrl: this.redirectUrl, scope: this.profile.auth.scope })
  }

  // ── state (per attempt, session-only) ─────────────────────────────────────

  state(): string {
    const value = this.newState()
    failIfNotStored(setSecret(this.key('state'), value, { persist: false }), 'state')
    return value
  }

  // ── client registration ───────────────────────────────────────────────────

  clientInformation(ctx?: OAuthClientInformationContext): StoredOAuthClientInformation | undefined {
    const preRegistered = this.profile.auth.clientId?.trim()
    if (preRegistered) {
      // A pre-registered public client: never registered dynamically, never persisted by us.
      return { client_id: preRegistered, ...(ctx?.issuer ? { issuer: ctx.issuer } : {}) }
    }
    const stored = readJson<StoredOAuthClientInformation>(this.key('client'))
    if (!stored || typeof stored.client_id !== 'string') return undefined
    // A registration made for another origin (different redirect URI) is useless here: register again.
    const uris = (stored as { redirect_uris?: unknown }).redirect_uris
    if (Array.isArray(uris) && !uris.includes(this.redirectUrl)) return undefined
    return stored
  }

  saveClientInformation(info: StoredOAuthClientInformation): void {
    if (this.profile.auth.clientId?.trim()) return // pre-registered: nothing to remember
    failIfNotStored(replaceSecret(this.key('client'), JSON.stringify(info), { persist: this.persist }), 'client registration')
    notifyCredentialsChanged()
  }

  // ── tokens ────────────────────────────────────────────────────────────────

  tokens(): StoredOAuthTokens | undefined {
    const stored = readJson<StoredOAuthTokens & { obtained_at?: number }>(this.key('tokens'))
    if (!stored || typeof stored.access_token !== 'string') return undefined
    const tokens: StoredOAuthTokens & { obtained_at?: number } = { ...stored }
    delete tokens.obtained_at
    return tokens
  }

  saveTokens(tokens: StoredOAuthTokens): void {
    // `obtained_at` lets the UI show an expiry time; it is stripped again in tokens().
    const record = { ...tokens, obtained_at: this.now() }
    failIfNotStored(replaceSecret(this.key('tokens'), JSON.stringify(record), { persist: this.persist }), 'tokens')
    // The one-time PKCE verifier and state have done their job once tokens exist.
    deleteSecret(this.key('verifier'))
    deleteSecret(this.key('state'))
    notifyCredentialsChanged()
  }

  // ── PKCE verifier + discovery state (survive the redirect round trip, session-only) ──

  saveCodeVerifier(codeVerifier: string): void {
    failIfNotStored(setSecret(this.key('verifier'), codeVerifier, { persist: false }), 'PKCE verifier')
  }

  codeVerifier(): string {
    const v = getSecret(this.key('verifier'))
    if (!v) throw new Error('No PKCE code verifier is stored for this sign-in. Start the sign-in again.')
    return v
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    failIfNotStored(setSecret(this.key('discovery'), JSON.stringify(state), { persist: false }), 'discovery state')
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return readJson<OAuthDiscoveryState>(this.key('discovery'))
  }

  // ── invalidation ──────────────────────────────────────────────────────────

  invalidateCredentials(scope: InvalidationScope): void {
    clearOAuthCredentials(this.profile.id, scope)
  }

  // ── sign-in redirect ──────────────────────────────────────────────────────

  redirectToAuthorization(authorizationUrl: URL): void {
    // The URL comes from the authorization server's metadata: never navigate to javascript:, data:, ...
    if (authorizationUrl.protocol !== 'https:' && authorizationUrl.protocol !== 'http:') {
      throw new Error(`Refusing to open a non-http(s) authorization URL (${authorizationUrl.protocol}).`)
    }
    const url = authorizationUrl.toString()
    // A stale full-page marker (an abandoned earlier redirect) would be copied into the popup's
    // sessionStorage and turn its callback into a full-page return. Clear it BEFORE the popup exists.
    deleteSecret(PENDING_RETURN_KEY)
    const popup = this.openWindow(url, POPUP_NAME, POPUP_FEATURES)
    if (popup) {
      try {
        // Reverse-tabnabbing guard: the authorization server's page must not reach this window via
        // window.opener. The callback flow uses a BroadcastChannel, not the opener.
        popup.opener = null
      } catch {
        // a browser that refuses is fine: nothing here depends on it
      }
      return
    }
    // Popup blocked: remember which profile is signing in, then leave this page. The callback route
    // completes the marker with the code and state and sends the browser back to the tool.
    failIfNotStored(
      setSecret(PENDING_RETURN_KEY, JSON.stringify({ profileId: this.profile.id }), { persist: false }),
      'sign-in marker',
    )
    this.assignLocation(url)
  }
}

/**
 * Builds the OAuth provider for a profile, or `undefined` when the profile does not use OAuth.
 * `origin` is `window.location.origin`; the redirect URI is exactly `${origin}/oauth/callback`.
 */
export function buildAuthProvider(profile: Profile, origin: string, deps: ProviderDeps = {}): OAuthClientProvider | undefined {
  if (profile.auth.mode !== 'oauth') return undefined
  return new McpOAuthProvider(profile, origin, deps)
}
