import { describe, expect, it } from 'vitest'
import type { Diagnosis, ServerSummary } from '../connection/types'
import type { Profile } from '../schemas'
import {
  defaultTab,
  diagnosisToText,
  isTabEnabled,
  preflight,
  profileToConfig,
  resolveActiveTab,
  statusLabel,
  summaryRows,
  TAB_DEFS,
} from './logic'

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Prod',
    url: '  https://mcp.test/mcp  ',
    transport: 'sse',
    protocolVersion: '2025-06-18',
    headers: [],
    persistSecrets: false,
    auth: { mode: 'none', scope: null, clientId: null },
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

describe('profileToConfig', () => {
  it('trims the url, copies transport and protocolVersion, and resolves headers (secrets via get)', () => {
    const p = profile({
      headers: [
        { id: 'h1', name: 'Authorization', value: '', secret: true, enabled: true },
        { id: 'h2', name: 'X-Plain', value: 'v', secret: false, enabled: true },
        { id: 'h3', name: 'X-Off', value: 'no', secret: false, enabled: false },
      ],
    })
    const get = (k: string) => (k === 'hdr:p1:h1' ? 'Bearer abc' : null)
    const r = profileToConfig(p, get)
    expect(r.config).toEqual({
      url: 'https://mcp.test/mcp',
      transport: 'sse',
      headers: [
        { name: 'Authorization', value: 'Bearer abc' },
        { name: 'X-Plain', value: 'v' },
      ],
      protocolVersion: '2025-06-18',
    })
    expect(r.invalid).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('reports invalid header names (excluded from the config) and warnings', () => {
    const p = profile({
      headers: [
        { id: 'h1', name: 'Bad Name', value: 'x', secret: false, enabled: true },
        { id: 'h2', name: 'Host', value: 'x', secret: false, enabled: true },
      ],
    })
    const r = profileToConfig(p, () => null)
    expect(r.invalid).toEqual(['Bad Name'])
    expect(r.config.headers.map((h) => h.name)).toEqual(['Host'])
    expect(r.warnings.join(' ')).toMatch(/Host.*ignored/)
  })

  it('carries a null protocol version through as auto', () => {
    expect(profileToConfig(profile({ protocolVersion: null }), () => null).config.protocolVersion).toBeNull()
  })
})

describe('preflight', () => {
  it('flags an invalid url with a reason and blocks connecting', () => {
    const r = preflight(profile({ url: 'ftp://x.test' }), () => null, 'https:')
    expect(r.urlOk).toBe(false)
    expect(r.urlError).toMatch(/http/)
    expect(r.canConnect).toBe(false)
  })

  it('does not show an error for an empty url, but still blocks connecting', () => {
    const r = preflight(profile({ url: '' }), () => null, 'https:')
    expect(r.urlError).toBeNull()
    expect(r.canConnect).toBe(false)
  })

  it('rejects embedded credentials', () => {
    const r = preflight(profile({ url: 'https://user:pw@x.test/' }), () => null, 'https:')
    expect(r.urlError).toMatch(/credentials/i)
    expect(r.canConnect).toBe(false)
  })

  it('reports mixed content on an https page for a non-loopback http url, without blocking', () => {
    const r = preflight(profile({ url: 'http://example.com/mcp' }), () => null, 'https:')
    expect(r.mixedContent).toBe(true)
    expect(r.canConnect).toBe(true)
    expect(preflight(profile({ url: 'http://localhost:3000/mcp' }), () => null, 'https:').mixedContent).toBe(false)
    expect(preflight(profile({ url: 'http://example.com/mcp' }), () => null, 'http:').mixedContent).toBe(false)
  })

  it('blocks connecting when a header name is invalid', () => {
    const p = profile({ url: 'https://x.test/mcp', headers: [{ id: 'h', name: 'A B', value: '', secret: false, enabled: true }] })
    const r = preflight(p, () => null, 'https:')
    expect(r.invalid).toEqual(['A B'])
    expect(r.canConnect).toBe(false)
  })
})

describe('tabs', () => {
  it('lists the six tabs in order', () => {
    expect(TAB_DEFS.map((t) => t.label)).toEqual(['Tools', 'Resources', 'Prompts', 'Raw', 'Conformance', 'Client'])
  })

  it('enables capability tabs only when advertised; raw/conformance/client always', () => {
    const caps = { tools: {} }
    expect(TAB_DEFS.filter((t) => isTabEnabled(t.id, caps)).map((t) => t.id)).toEqual([
      'tools',
      'raw',
      'conformance',
      'client',
    ])
    expect(isTabEnabled('resources', {})).toBe(false)
    expect(isTabEnabled('prompts', { prompts: { listChanged: true } })).toBe(true)
  })

  it('defaults to tools when enabled, else raw', () => {
    expect(defaultTab({ tools: {} })).toBe('tools')
    expect(defaultTab({ resources: {} })).toBe('raw')
  })

  it('falls back to the default when the requested tab is not enabled', () => {
    expect(resolveActiveTab('prompts', { tools: {} })).toBe('tools')
    expect(resolveActiveTab('prompts', { prompts: {} })).toBe('prompts')
    expect(resolveActiveTab('tools', {})).toBe('raw')
    expect(resolveActiveTab('client', {})).toBe('client')
  })
})

describe('text helpers', () => {
  const info: ServerSummary = {
    serverName: 'srv',
    serverVersion: '1.2',
    title: null,
    protocolVersion: '2025-06-18',
    capabilities: { tools: {}, logging: {} },
    instructions: null,
    transport: 'streamable-http',
    sessionId: null,
  }

  it('summaryRows shows protocol, transport, session id (or none) and capability keys', () => {
    const rows = Object.fromEntries(summaryRows(info).map((r) => [r.label, r.value]))
    expect(rows['Server']).toBe('srv 1.2')
    expect(rows['Protocol version']).toBe('2025-06-18')
    expect(rows['Transport']).toBe('Streamable HTTP')
    expect(rows['Session ID']).toBe('none')
    expect(rows['Capabilities']).toBe('tools, logging')
    const sse = Object.fromEntries(summaryRows({ ...info, transport: 'sse', sessionId: 'abc', capabilities: {} }).map((r) => [r.label, r.value]))
    expect(sse['Transport']).toBe('Legacy HTTP+SSE')
    expect(sse['Session ID']).toBe('abc')
    expect(sse['Capabilities']).toBe('none')
  })

  it('diagnosisToText includes title, detail, status and every hint', () => {
    const d: Diagnosis = {
      code: 'http-status',
      title: 'Server error',
      detail: 'HTTP 500 from server',
      hints: ['check logs', 'retry later'],
      httpStatus: 500,
    }
    const text = diagnosisToText(d)
    expect(text).toContain('Server error')
    expect(text).toContain('HTTP 500 from server')
    expect(text).toContain('HTTP status: 500')
    expect(text).toContain('- check logs')
    expect(text).toContain('- retry later')
    expect(diagnosisToText({ ...d, httpStatus: null, hints: [] })).not.toContain('HTTP status')
  })

  it('statusLabel covers every state', () => {
    expect(statusLabel({ status: 'disconnected' })).toBe('Disconnected')
    expect(statusLabel({ status: 'connecting' })).toBe('Connecting')
    expect(statusLabel({ status: 'auth-required' })).toBe('Authorization required')
  })
})
