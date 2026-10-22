// Pure helpers for the MCP Inspector shell (contract C6): profile -> connection config,
// capability -> tab mapping, and plain-text rendering of summaries/diagnostics.
// No React, no storage access (secrets are read through the injected `get`).

import type { McpSession } from '../connection/session'
import type { ConnectionConfig, Diagnosis, ServerSummary, SessionOptions, SessionState, TransportKind } from '../connection/types'
import { mixedContentRisk, validateServerUrl } from '../connection/logic'
import { resolveHeaders } from '../logic'
import type { Profile } from '../schemas'
import type { TabId } from './uiStore'

/** Props every tab component receives (contract C6 item 4). Tabs are default exports. */
export interface TabProps {
  session: McpSession // connected
  info: ServerSummary
  sessionOptions: Omit<SessionOptions, 'onLog' | 'onState'> // so a tab may open extra throwaway sessions (conformance)
  profileId: string
}

// ── Profile -> config ─────────────────────────────────────────────────────────

export interface ProfileConfigResult {
  config: ConnectionConfig
  /** Header names that are not valid HTTP tokens. Non-empty blocks Connect. */
  invalid: string[]
  warnings: string[]
}

/** Builds the connection config for a profile. Secret header values come from `get`, never from the profile. */
export function profileToConfig(profile: Profile, get: (key: string) => string | null): ProfileConfigResult {
  const { headers, invalid, warnings } = resolveHeaders(profile, get)
  return {
    config: {
      url: profile.url.trim(),
      transport: profile.transport,
      headers,
      protocolVersion: profile.protocolVersion,
    },
    invalid,
    warnings,
  }
}

// ── Pre-flight ────────────────────────────────────────────────────────────────

export const MIXED_CONTENT_WARNING =
  'This page is served over HTTPS, but the server URL uses plain http:// on a non-loopback host. Browsers block such "mixed content" requests. Use an https:// URL, or http://localhost for a local server.'

export interface Preflight {
  /** Inline reason the URL is unusable; null when valid OR still empty (see urlOk). */
  urlError: string | null
  urlOk: boolean
  /** Header names that are not valid HTTP tokens. Block Connect. */
  invalid: string[]
  warnings: string[]
  /** Non-blocking: an https page cannot call this http URL. */
  mixedContent: boolean
  canConnect: boolean
}

/** Everything the UI needs to know before the user presses Connect. */
export function preflight(profile: Profile, get: (key: string) => string | null, pageProtocol: string): Preflight {
  const check = validateServerUrl(profile.url)
  const { invalid, warnings } = profileToConfig(profile, get)
  const empty = profile.url.trim() === ''
  return {
    urlError: check.ok || empty ? null : check.reason,
    urlOk: check.ok,
    invalid,
    warnings,
    mixedContent: check.ok && mixedContentRisk({ pageProtocol, url: check.url }),
    canConnect: check.ok && invalid.length === 0,
  }
}
// ── Tabs ──────────────────────────────────────────────────────────────────────

export interface TabDef {
  id: TabId
  label: string
  /** Server capability key that must be advertised; null = always enabled. */
  capability: string | null
}

export const TAB_DEFS: readonly TabDef[] = [
  { id: 'tools', label: 'Tools', capability: 'tools' },
  { id: 'resources', label: 'Resources', capability: 'resources' },
  { id: 'prompts', label: 'Prompts', capability: 'prompts' },
  { id: 'raw', label: 'Raw', capability: null },
  { id: 'conformance', label: 'Conformance', capability: null },
  { id: 'client', label: 'Client', capability: null },
]

export const TAB_DISABLED_REASON = 'Server does not advertise this capability'

export function isTabEnabled(id: TabId, capabilities: Record<string, unknown>): boolean {
  const def = TAB_DEFS.find((t) => t.id === id)
  if (!def) return false
  return def.capability === null || Object.prototype.hasOwnProperty.call(capabilities, def.capability)
}

/** `tools` when the server advertises it, else `raw`. */
export function defaultTab(capabilities: Record<string, unknown>): TabId {
  return isTabEnabled('tools', capabilities) ? 'tools' : 'raw'
}

/** The tab to show: the requested one if the server supports it, else the default. */
export function resolveActiveTab(requested: TabId, capabilities: Record<string, unknown>): TabId {
  return isTabEnabled(requested, capabilities) ? requested : defaultTab(capabilities)
}

// ── Text ──────────────────────────────────────────────────────────────────────

export function transportLabel(kind: TransportKind): string {
  return kind === 'sse' ? 'Legacy HTTP+SSE' : 'Streamable HTTP'
}

export function statusLabel(state: SessionState): string {
  switch (state.status) {
    case 'disconnected':
      return 'Disconnected'
    case 'connecting':
      return 'Connecting'
    case 'connected':
      return 'Connected'
    case 'auth-required':
      return 'Authorization required'
    case 'error':
      return 'Error'
  }
}

export interface SummaryRow {
  label: string
  value: string
}

/** Rows of the server summary, in display order. Capabilities are keys only. */
export function summaryRows(info: ServerSummary): SummaryRow[] {
  const keys = Object.keys(info.capabilities)
  return [
    { label: 'Server', value: `${info.serverName} ${info.serverVersion}` },
    { label: 'Protocol version', value: info.protocolVersion || 'unknown' },
    { label: 'Transport', value: transportLabel(info.transport) },
    { label: 'Session ID', value: info.sessionId ?? 'none' },
    { label: 'Capabilities', value: keys.length > 0 ? keys.join(', ') : 'none' },
  ]
}

/** Plain-text copy of a diagnosis (what the "Copy diagnostics" button copies). */
export function diagnosisToText(d: Diagnosis): string {
  const lines = [d.title, '', d.detail]
  if (d.httpStatus !== null) lines.push('', `HTTP status: ${d.httpStatus}`)
  if (d.hints.length > 0) {
    lines.push('', 'Things to check:')
    for (const h of d.hints) lines.push(`- ${h}`)
  }
  return lines.join('\n')
}

/** A diagnosis for failures that happen in the shell itself (not in the connection layer). */
export function localDiagnosis(code: Diagnosis['code'], title: string, detail: string, hints: string[] = []): Diagnosis {
  return { code, title, detail, hints, httpStatus: null }
}
