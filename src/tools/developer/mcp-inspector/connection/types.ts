import type { Client, ClientCapabilities, OAuthClientProvider, Transport } from '@modelcontextprotocol/client'

export type TransportKind = 'streamable-http' | 'sse'

/** First protocol revision of the SDK's modern (server/discover) era; earlier revisions use the legacy `initialize` handshake. */
export const FIRST_MODERN_PROTOCOL_VERSION = '2026-07-28'

export interface ConnectionConfig {
  url: string // absolute http(s) URL, no embedded credentials
  transport: 'auto' | TransportKind // 'auto' = try streamable-http, fall back to sse (C3 rule)
  headers: { name: string; value: string }[] // already resolved; only enabled, valid headers; secrets included
  protocolVersion: string | null // null = auto-negotiate; else one of SUPPORTED_PROTOCOL_VERSIONS
}

export type LogEntry =
  | {
      id: number
      ts: number
      tag?: string
      kind: 'rpc'
      direction: 'out' | 'in'
      message: unknown // the JSON-RPC message exactly as sent/received
      method: string | null // request/notification method; null for responses
      rpcId: string | number | null // null for notifications
      durationMs: number | null // ONLY on direction 'in' responses: ms since the matching 'out' request; else null
    }
  | {
      id: number
      ts: number
      tag?: string
      kind: 'http'
      method: string
      url: string
      status: number | null // null if no response (network error)
      requestHeaders: Record<string, string> // REDACTED
      responseHeaders: Record<string, string> | null // REDACTED
      durationMs: number | null // ms until response headers arrived
      error: string | null
    }
  | { id: number; ts: number; tag?: string; kind: 'event'; level: 'info' | 'warn' | 'error'; text: string }
export type LogEntryInput = LogEntry extends infer E ? (E extends unknown ? Omit<E, 'id'> : never) : never
// `id` is assigned ONLY by useLogStore.append (strictly increasing, starting at 1, never reused). `ts` = Date.now() epoch ms.

export interface Diagnosis {
  code:
    | 'cors-or-network'
    | 'mixed-content'
    | 'unauthorized'
    | 'forbidden'
    | 'http-status'
    | 'session-expired'
    | 'timeout'
    | 'protocol'
    | 'unknown'
  title: string
  detail: string // human sentence(s); includes the original error message
  hints: string[] // concrete actionable checklist items (may be empty)
  httpStatus: number | null
}

export interface ServerSummary {
  serverName: string
  serverVersion: string
  title: string | null
  protocolVersion: string // negotiated
  capabilities: Record<string, unknown> // as returned by the server
  instructions: string | null
  transport: TransportKind // the one actually in use
  sessionId: string | null
}

export type SessionState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; info: ServerSummary }
  | { status: 'auth-required' }
  | { status: 'error'; diagnosis: Diagnosis }

export type RawResult =
  | { ok: true; result: unknown; durationMs: number }
  | { ok: false; error: { code: number | null; message: string; data?: unknown }; durationMs: number }
// code === null means a local failure (timeout/abort/network), not a JSON-RPC error from the server

export interface ClientFeatureSetup {
  // supplied by client-features/register.ts (P11 replaces the P5 no-op)
  capabilities: ClientCapabilities // declared at Client construction
  configure(client: Client): void // registers request handlers; called before connect
  dispose(): void // reject/clear pending requests; called on disconnect
}

export interface SessionOptions {
  config: ConnectionConfig
  onLog: (e: LogEntryInput) => void
  onState: (s: SessionState) => void
  authProvider?: OAuthClientProvider
  clientSetup?: ClientFeatureSetup
  // test seams (production code leaves these undefined):
  fetchImpl?: typeof fetch
  transportFactory?: (
    kind: TransportKind,
    ctx: {
      url: URL
      fetch: typeof fetch
      headers: Record<string, string>
      authProvider?: OAuthClientProvider
      protocolVersion: string | null
    },
  ) => Transport
  now?: () => number
}
