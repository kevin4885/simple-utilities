# MCP Inspector — CLAUDE.md

Tool id `mcp-inspector` (category Developer, route `/tools/mcp-inspector`). Connects to a remote
MCP server from the browser, lets the user exercise tools / resources / prompts, shows every
HTTP and JSON-RPC message, signs in with OAuth, runs conformance checks and answers
server-to-client requests. Frontend only, no backend, no proxy.

This is the reference for a **large, multi-area tool**: instead of one `logic.ts`/`index.tsx`, each
area is its own folder with its own pure `logic.ts` + `logic.test.ts` (a deliberate deviation from
the one-`logic.ts` convention in `src/tools/CLAUDE.md`). Only `registry.ts` (one entry) and
`src/app/App.tsx` (the `/oauth/callback` route) live outside this folder.

Pinned SDK: **`@modelcontextprotocol/client` 2.3.1** (exact version in `package.json`, not a caret).
Nothing else MCP-related is a dependency.

## Folder map

```
src/tools/developer/mcp-inspector/
  index.tsx                 default export; only mounts shell/McpInspectorShell
  schemas.ts                Zod schemas + types for everything persisted (Profile, HeaderEntry, HistoryEntry, Prefs, import shapes) and the limits
  store.ts                  useMcpInspectorStore (zustand persist, key su:mcp-inspector) + mergePersisted rehydration
  secrets.ts                the ONLY module that touches the two secret storages (see Secrets)
  logic.ts                  pure: resolveHeaders, isSecretHeaderName, export/importProfiles, secret key helpers, id/name/args helpers
  connection/               the SDK-backed session
    types.ts                shared types: ConnectionConfig, LogEntry, Diagnosis, ServerSummary, SessionState, SessionOptions, ClientFeatureSetup
    session.ts              createSession / McpSession (connect, disconnect, finishAuth, rawRequest, rawNotification, onNotification, onListChanged)
    tap.ts                  createFetchTap (HTTP log + cross-origin header guard) and TappedTransport (JSON-RPC log decorator)
    logic.ts                pure: validateServerUrl, mixedContentRisk, redactHeaders, classifyConnectionError, collectPages, secret scrubbing helpers
  schema-form/              JSON-Schema subset -> form (logic.ts pure; SchemaForm.tsx); index.ts is the public surface
  shell/                    page chrome and shared runtime state
    McpInspectorShell.tsx   full-bleed page: sidebar, status, diagnosis, summary, TabHost, LogDrawer, ClientFeatureHost
    ConnectionSidebar.tsx   profile list/editor, headers, import/export, AuthPanel
    TabHost.tsx             static tab list + capability gating + epoch remount
    useConnection.ts        owns one McpSession for the active profile (connect/disconnect/OAuth wait/retry/full-page resume)
    logic.ts                pure: profileToConfig, preflight, TAB_DEFS / tab enablement, summary + diagnosis text
    logStore.ts uiStore.ts  runtime (NOT persisted) zustand stores: the message log (cap 1000) and active tab / raw-tab draft
    LogDrawer.tsx JsonView.tsx ContentView.tsx viewerIo.ts   shared safe viewers + thin clipboard/download IO
  tabs/<tab>/               one folder per tab, each a default-exported component taking TabProps
    tools/ resources/ prompts/ raw/ conformance/ client/        (tools, resources, prompts and raw also have a pure logic.ts / uriTemplate.ts)
  auth/                     OAuth
    provider.ts             buildAuthProvider -> SDK OAuthClientProvider backed by secrets.ts; popup + pending-return marker
    flow.ts                 completeAuthorization, consumePendingOAuthReturn, the lost-message buffer
    callback.ts             SDK-free constants/types/parsers shared with the callback route (OAUTH_CHANNEL, OAuthCallbackMessage, parseCallbackParams, validateState)
    OAuthCallbackPage.tsx   the /oauth/callback page (lazy route in src/app/App.tsx, outside AppShell)
    AuthPanel.tsx logic.ts  sidebar auth section; pure client metadata + classifyOAuthError
  client-features/          roots / sampling / elicitation / server logging
    register.ts             clientFeatureSetup (capabilities + handler registration + dispose)
    settingsStore.ts        persisted settings, key su:mcp-inspector-client
    pendingStore.ts         runtime queue of pending sampling/elicitation requests + answered history + server log notifications
    Host.tsx logic.ts       the request dialogs; pure parsing/validation/result builders
  conformance/              check engine (types.ts, checks.ts catalogue, runner.ts, report.ts); UI is tabs/conformance
  testing/fakeServer.ts     shared fake MCP server for tests
```

## Data flow

`Profile` (persisted, no secret values) + `secrets.ts` -> `profileToConfig` (`shell/logic.ts`) ->
`ConnectionConfig` -> `createSession` (`connection/session.ts`) -> `McpSession`.

`McpSession` wraps the SDK `Client` and installs two taps so **nothing else logs manually**: a
`fetch` wrapper (HTTP level, headers redacted) and a decorator `Transport` (JSON-RPC level, pairs
requests with responses and times them). Both write to `useLogStore` through `onLog`. Tabs receive
a *connected* `session` and call `session.client.<method>(...)` directly.

`useConnection` (one per page) creates a **new session on every user-initiated connect** (so edited
profiles and fresh secrets are always picked up) and bumps `epoch` on each successful connect.
`TabHost` keys the active tab on `${tab}:${epoch}`, so tabs remount after a reconnect and never hold
a stale `session.client` — never cache `session.client` across reconnects.

`transport: 'auto'` tries Streamable HTTP and falls back to legacy SSE **only** on HTTP 400/404/405
(never 401/403/5xx or a network `TypeError`). `protocolVersion: null` uses the SDK's `auto`
negotiation, which sends one extra `server/discover` probe on every connect (visible in the log); a
legacy pin skips it; a modern (`2026-07-28`) pin is strict.

Every call a tab makes is recorded with `useMcpInspectorStore.pushHistory` (no-op when
`prefs.saveHistory` is false; capped at 200 entries, `argsJson` at 20000 chars).

## Slots: how to add a tab

A tab is a default-exported component taking `TabProps` (`shell/logic.ts`:
`{ session, info, sessionOptions, profileId }`, rendered only while connected). `TabHost` lists tabs
statically, so there is no registration at runtime. To add a tab, edit exactly these places:

1. `tabs/<id>/<Name>Tab.tsx` (+ test, + `logic.ts`/`logic.test.ts` if it has pure logic).
2. `shell/uiStore.ts` — add the id to the `TabId` union.
3. `shell/logic.ts` — add a `TAB_DEFS` entry (`id`, `label`, `capability`: the server capability key
   that must be advertised, or `null` for always enabled).
4. `shell/TabHost.tsx` — import the component and add it to `TAB_COMPONENTS` (typed `Record<TabId, …>`,
   so TypeScript fails until you do).

Capability-gated tabs (`tools`, `resources`, `prompts`) are disabled with a title tooltip when the
server does not advertise the key; `resolveActiveTab` falls back to `tools`, else `raw`. A tab that
wants to open extra throwaway sessions (conformance does) uses `sessionOptions`.

Other runtime hand-offs go through `shell/uiStore.ts` (e.g. `setRawDraft` + `setActiveTab('raw')` is how
the log drawer's "Edit & resend" prefills the Raw tab; the draft carries an increasing `nonce`).

## Testing: `testing/fakeServer.ts`

`createFakeServer(options)` is a hand-written JSON-RPC responder behind an SDK `InMemoryTransport`.
It is intentionally **not** built on the SDK server package, so a test can model a compliant or a
deliberately non-compliant server. It speaks the legacy `initialize` handshake and answers
`-32601` to anything it does not know (including `server/discover`, so `auto` negotiation falls back).

```ts
const fake = createFakeServer({ capabilities: { tools: {} }, tools: [...], toolHandlers: {...}, pageSize: 2 })
const session = createSession({
  config: { url: 'https://mcp.test/mcp', transport: 'auto', headers: [], protocolVersion: null },
  onLog, onState,
  transportFactory: () => fake.clientTransport as Transport,   // injected seam; production leaves it undefined
})
await session.connect()
```

Options: `serverInfo, protocolVersion, sessionId, capabilities, instructions, tools, toolHandlers,
resources, resourceTemplates, resourceContents, prompts, promptHandlers, pageSize, latencyMs,
rejectMethods, onRequest` (`onRequest` may return `'no-response'` or an override). Returned:
`clientTransport`, `received` (every client message in order), `sendNotification`,
`sendRequest` (server-to-client request, resolves with the client's raw reply), `close`.

Other seams on `SessionOptions`: `fetchImpl` (HTTP-level behaviour: status codes, headers, SSE
fallback, session DELETE) and `now`. `auth/auth.integration.test.ts` runs the SDK's **real** `auth()`
and real transport over a fake `fetch` (401 + resource metadata, AS metadata, `/register`, `/token`).

Conventions: tests import `describe/it/expect/vi` from `vitest` explicitly; React 19 lint rules
(`set-state-in-effect`, `purity`) reject "read storage in an effect" and `Date.now()` in render —
use `useSyncExternalStore` / derived state (see `auth/AuthPanel.tsx`).

## Secrets and storage

| key | storage | contents |
|---|---|---|
| `su:mcp-inspector` | localStorage (zustand persist, `version: 1`) | `{profiles, activeProfileId, history, prefs}` — never a secret value |
| `su:mcp-inspector-secrets` | localStorage | flat `Record<string,string>`; ONLY entries of profiles with `persistSecrets: true` |
| `su:mcp-inspector-session` | **sessionStorage** | flat `Record<string,string>`; secrets by default, plus transient OAuth state |
| `su:mcp-inspector-client` | localStorage (zustand persist) | client-feature settings (roots, sampling, elicitation, logging level) |

Everything is Zod-validated on read; garbage yields defaults and never throws.

- `secrets.ts` is the only module that touches the two secret tiers. Session value wins over persisted
  on read. Key namespaces: `hdr:<profileId>:<headerId>`, `oauth:<profileId>:tokens|client|verifier|state|discovery`,
  `oauth:pending-return`. `verifier`, `state`, `discovery` and `pending-return` are **always** session-only.
- Secret header values never enter the persisted profile blob (`value` is `''` when `secret` is true);
  `store.updateProfile` moves them into `secrets.ts` using the profile's `persistSecrets`.
  Flipping `persistSecrets` re-homes the secrets (`syncPersistedTier`); `deleteProfile` removes a
  profile's secrets from both tiers; `duplicateProfile` copies none; export strips them and forces
  `persistSecrets: false`; import regenerates ids.
- Header names that look secret (`isSecretHeaderName`: `authorization`, `proxy-authorization`, `cookie`,
  `set-cookie`, or matching `token|secret|key|password|auth`) default to `secret: true` and are
  `[redacted]` in HTTP log entries. JSON-RPC bodies are **not** redacted (they are the user's payload).
- **Scrub list.** `McpSession` keeps one growing list of literal secret fragments (>= 4 chars): every
  configured header value, plus OAuth credentials learned at runtime — access / refresh / id tokens,
  `client_secret`, `registration_access_token`, the authorization code and PKCE verifier. They are
  learned (a) by wrapping the `authProvider` in a Proxy (`withSecretCapture`) and (b) by the fetch tap
  scanning request bodies and a bounded (64 KB, cloned) copy of non-SSE JSON/text response bodies
  (`onLearn`). The list is applied to error text, diagnoses, event text and logged URLs (`scrubSecrets`);
  secret-looking URL query parameters are redacted in logged URLs. Tokens under 4 chars are not scrubbed.
- **Cross-origin header guard.** User-configured header *names* are removed from any request whose origin
  differs from the MCP server's (OAuth discovery / registration / token endpoints), so a token typed for the
  server is never sent to a third-party authorization server.
- Conformance reports (`conformance/report.ts`) contain no header values, tokens or session id.

## OAuth (`auth/`)

- Public client only (`token_endpoint_auth_method: 'none'`); PKCE and RFC 8707 `resource` come from the SDK.
  Redirect URI is exactly `${location.origin}/oauth/callback`. `skipIssuerMetadataValidation` is never exposed.
  An optional pre-registered client id (profile `auth.clientId`) skips dynamic registration.
- Popup (`window.open`, name `mcp-oauth`, `opener = null`) -> authorization server -> `/oauth/callback`
  page posts one `OAuthCallbackMessage` on a **same-origin `BroadcastChannel`** (`su-mcp-oauth`) and closes.
  If the popup is blocked, `oauth:pending-return` is stored and the page does a full-page redirect; the
  callback page then writes `{profileId, code, state, iss, error, errorDescription}` into that marker and
  navigates back to `/tools/mcp-inspector`, where `useConnection` picks it up (`consumePendingOAuthReturn`).
- `state` is 256 random bits, generated per attempt, persisted session-only, verified on return
  (`validateState` + the stored value) and single-use; a mismatch is ignored with a warn event. The code/state
  are never rendered and are removed from the address bar.
- **RFC 9207 `iss`.** The `iss` redirect parameter is carried unchanged (message -> marker -> `McpSession.finishAuth(code, iss)`
  -> `transport.finishAuth(code, iss)`); app code never compares it — the SDK alone validates it against the
  discovered issuer (it *requires* it when the AS metadata says `authorization_response_iss_parameter_supported`).
  A mismatch is a hard failure; `IssuerMismatchError` maps to a `protocol` diagnosis "Authorization server issuer mismatch".
- **Lost-message buffer** (`auth/flow.ts`): `connect()` returns `auth-required` only *after* the popup opened, so a fast
  redirect could post before `completeAuthorization` listens. `provider.redirectToAuthorization` therefore calls
  `startCallbackBuffer()` (only when the popup opened); a single-slot module-level `BroadcastChannel` keeps the latest valid
  message, and `completeAuthorization` takes it first and runs it through the normal state check. The buffer is cleared on
  take / abort / new sign-in and after 5 minutes.
- The SDK needs `saveDiscoveryState`/`discoveryState` on the provider for the callback leg (else
  `AuthorizationServerMismatchError`); they are implemented session-only.
- `auth/callback.ts`, `OAuthCallbackPage.tsx` and `secrets.ts` must **not** import the SDK (asserted by
  `auth/callback.test.ts`) — this keeps the lazy callback route tiny and the SDK out of the app entry chunk.
- Known limit: `McpSession.finishAuth` rethrows a plain `Error`, so typed OAuth error classes are lost on the finish path
  (the message is still shown); `useConnection`'s authorization-failure label is generic.

## Security rules

- **Untrusted server content is text.** Tool results, prompt messages, resource contents, elicitation/sampling text,
  server log messages, descriptions and titles are rendered as React text — never `innerHTML` / `dangerouslySetInnerHTML` /
  markdown-to-HTML. Add a test with `<img src=x onerror=alert(1)>` for any new surface that shows server text.
- **Images/audio** (`shell/ContentView.tsx`): only `image/png|jpeg|gif|webp` render, via `data:` URLs; SVG and every other image type show
  "Unsupported image type" with mime and size. Audio uses a `data:` URL. Blobs download only on an explicit click.
- **Server-supplied URLs** (`resource_link`, elicitation URL mode, icons) are never fetched or opened automatically. Server `icons` are
  not loaded (would leak the user's IP). The only server-URL opener is the elicitation "Open link" button
  (`client-features/Host.tsx`): enabled only for `http:`/`https:`, `window.open(url, '_blank', 'noopener,noreferrer')`, on click only; the
  full URL and host are shown first.
- **Dangerous calls:** a tool with `annotations.destructiveHint === true` needs an explicit confirmation (`AlertDialog`) before `tools/call`.
- **Outbound requests** go only to the URL the user typed and the OAuth endpoints discovered from it. `validateServerUrl` rejects
  non-`http(s)` URLs and embedded credentials (`https://user:pw@host`) — credentials go in headers.
- Conformance checks never mutate server state except through the named throwaway session (`http.session-delete`) and the opt-in
  `tools.call-smoke`.

## Browser limits (also explained to the user by the diagnostics)

- **HTTP only; no stdio.** A browser cannot spawn a process. The sidebar tells the user to bridge a stdio server to HTTP with an
  external tool; no specific command line is hard-coded.
- **CORS.** The server must allow the app origin, expose `Mcp-Session-Id` (`Access-Control-Expose-Headers`) and allow request headers
  `Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version` plus any custom ones. A blocked request surfaces as an
  opaque `TypeError: Failed to fetch`; `classifyConnectionError` turns it into a `cors-or-network` diagnosis with a checklist. The
  same holds for the authorization server's metadata, registration and token endpoints (`auth/logic.ts` `classifyOAuthError`).
- **Mixed content.** An https page cannot call `http://` servers except loopback (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`);
  `mixedContentRisk` drives a non-blocking warning. Chrome Private Network Access preflights can additionally apply to localhost targets.
- Fetch-forbidden header names (`Host`, `Origin`, `Cookie`, `proxy-*`, `sec-*`, …) are silently dropped by the browser and transport-managed
  ones (`Accept`, `Content-Type`, `Mcp-Session-Id`, `MCP-Protocol-Version`) are overridden by the SDK; `resolveHeaders` lists them as warnings.

## SDK notes: where to look when upgrading `@modelcontextprotocol/client`

Version is pinned exactly (`package.json`); an upgrade is a deliberate change. Read the package's `dist/index.mjs` and `dist/*.d.mts`, then
re-run `src/tools/developer/mcp-inspector` tests (the real-SDK tests in `connection/session.test.ts`, `auth/auth.integration.test.ts`
and `testing/fakeServer.test.ts` are the tripwires) and `npm run build` (bundle check below). Facts the code depends on:

- **Negotiation** (`session.ts` `buildClient`): `new Client(info, { versionNegotiation, supportedProtocolVersions, capabilities, ... })`. SDK default is
  `'legacy'`; the app uses `{mode:'auto'}` for "Auto", `{mode:'legacy'}` + `supportedProtocolVersions:[pin]` for a legacy pin, and `{mode:{pin}}` for a
  modern pin (`>= 2026-07-28`, strict). `auto` probes `server/discover` (string id `server-discover-probe-1`, so log `rpcId` may be a string) and
  falls back to `initialize` on `-32601` / HTTP 400/404/405; in a browser an opaque `TypeError` on the probe counts as legacy and the following
  `initialize` fails the same way. `FIRST_MODERN_PROTOCOL_VERSION` is defined locally in `connection/types.ts` (the SDK does not export it).
- **Errors** (`connection/logic.ts` `classifyConnectionError`, `getHttpStatus`): `SdkHttpError` (status at `error.status`, brand-based `instanceof`);
  `UnauthorizedError` (no status; ONLY this maps to `auth-required`; a 401 without an authProvider is an `SdkHttpError`); legacy
  `SSEClientTransport` throws a plain `Error('Error POSTing to endpoint (HTTP nnn)…')` for a non-OK POST and `SseError` (numeric `.code`) for the GET;
  `getHttpStatus` deliberately ignores OAuth errors (a rejected registration says `(HTTP 400)` and must not trigger the SSE fallback). OAuth flow errors
  (`RegistrationRejectedError`, `InsecureTokenEndpointError`, `AuthorizationServerMismatchError`, `InsufficientScopeError`, `IssuerMismatchError`) derive from
  `OAuthClientFlowError`. A non-OK POST error message contains the response body, so it is scrubbed.
- **The SDK rewrites some error codes.** `ProtocolError.fromError` turns a received `-32002` (resource not found) into `ResourceNotFoundError` with
  code **`-32602`** (also `-32602` carrying `{uri}`), so a tab never sees `-32002` from `resources/read`.
- **Raw and custom requests** (`ANY_RESULT` in `connection/session.ts` and `tabs/tools/logic.ts`, used by `tabs/tools/ToolsTab.tsx`): `client.request({method, params}, schema, options)` accepts any method
  when the 2nd argument is a StandardSchema; the app passes a permissive `{'~standard': {version:1, vendor, validate: v => ({value: v})}}`. Spec methods
  passed WITHOUT a schema are validated and era-gated (`MethodNotSupportedByProtocolVersion`). **`tools/call` uses `client.request`, not `client.callTool`**,
  so the result is shown exactly as the server sent it (the declared `outputSchema` is only checked, non-blocking, by `checkOutputSchema`) and per-call `timeout` / `signal` / `onprogress` are available.
  A timeout and an abort both surface as `SdkError(RequestTimeout)`: tell them apart by `signal.aborted` (as `rawRequest` does).
- **Pagination.** `client.listTools()/listPrompts()/listResources()/listResourceTemplates()` called *without* a cursor auto-aggregate every page (cap
  `listMaxPages` 64, then `ListPaginationExceeded`) and fill the SDK's response cache; per-page walking (`collectPages`, max 50 pages) uses
  `client.request({method:'tools/list', params: cursor ? {cursor} : {}})` — an empty-string cursor is sent as a real cursor.
- **Notifications.** `client.notification()` works for any method except era-gated ones; `notifications/roots/list_changed` additionally needs the client's
  `roots.listChanged` capability. `McpSession.onNotification` / `onListChanged` observe at the transport tap, independent of (and after) SDK handlers.
- **Client capabilities are fixed at `Client` construction** and `setRequestHandler` throws `SdkError(CapabilityNotSupported)` unless declared
  (`sampling` for `sampling/createMessage`, `elicitation` for `elicitation/create`, `roots` for `roots/list`). `McpSession` builds a fresh `Client` per attempt,
  calls `clientSetup.configure(client)` before `connect`, and `dispose()` once per teardown — a slow `close()` can make an old attempt's `dispose()` arrive after the
  next `configure()`, so `client-features/register.ts` keeps all state per context id and also cancels each request with its own `ctx.mcpReq.signal`.
  Elicitation URL mode needs `elicitation: {url: {}}` (the app declares `{form:{}, url:{}}`).
- **Roots `listChanged` is inactive in the app.** `useConnection` passes the module-level `clientFeatureSetup`, built by `createClientFeatureSetup()` without options,
  so it declares plain `{roots:{}}`: the server sees the roots as they were at connect time and editing roots shows "Reconnect to apply" instead of sending
  `notifications/roots/list_changed`. The `rootsListChanged` option exists in `createClientFeatureSetup` (and `ClientTab` sends the notification when it was declared) for
  tests and servers that need it, but nothing in the app turns it on.
- **Modern era (`2026-07-28`)** has no server-to-client request channel: servers answer `tools/call|prompts/get|resources/read` with an `input_required` result
  that the `Client` fulfils through the same registered handlers (`ClientOptions.inputRequired`). The fake server and today's servers use the legacy era.
- **Transport options used:** `requestInit.headers` (configured headers; the SDK's own `Authorization` / `mcp-session-id` / `mcp-protocol-version` / `content-type` /
  `accept` are set on top and win), `fetch` (the HTTP tap), `authProvider`. `terminateSession()` on disconnect is bounded to 3 s. Also check that
  `StreamableHTTPClientTransport`, `SSEClientTransport`, `finishAuth(code, iss?)`, `InMemoryTransport.createLinkedPair()` and the OAuth helper exports still exist.
- **Bundle:** the SDK must stay in the lazy `mcp-inspector` tool chunk (whole chunk ~440 KB, 120 KB gzip, at SDK 2.3.1). After an upgrade run `npm run build` and confirm the entry script
  named by `dist/index.html` (and the chunks it statically imports) contains none of `StreamableHTTPClientTransport`, `SSEClientTransport`, `server/discover`
  and that no emitted JS asset exceeds the 4 MiB PWA precache cap in `vite.config.ts`.

## Layout, UI and gotchas

- Full-bleed tool: root is `flex flex-col h-full overflow-hidden`, internal panes scroll; never `h-screen`. Semantic Tailwind tokens only.
- Components used from `src/components/ui/`, including `select` and `badge`. **shadcn CLI gotcha:** CLI 4.22.1 emitted `import { cn } from "cn"` in
  `select.tsx` and `badge.tsx`, which does not resolve; both were hand-fixed to `import { cn } from "@/lib/utils"`. If you re-add or update either component
  with the CLI, re-check that import line.
- `/oauth/callback` is a lazy route in `src/app/App.tsx`, a sibling of `/` outside `AppShell` (no Header / Ctrl+K), declared before `*`, and is **not**
  prerendered (`scripts/prerender/logic.ts` `getStaticRoutes()` stays `2 + tools.length`).
- `src/tools/registry.ts` has the single registry entry; routes, nav, search and prerender derive from it.
- Runtime stores (`shell/logStore.ts`, `shell/uiStore.ts`, `client-features/pendingStore.ts`) are not persisted.
- Log entries use ids assigned only by `useLogStore.append` (strictly increasing, never reused after `clear()`); `rpcId` can be a string.
