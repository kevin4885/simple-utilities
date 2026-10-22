import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/client'
import { collectPages, errorMessage, scrubSecrets, secretFragments, type CollectedPages } from '../connection/logic'
import { createSession } from '../connection/session'
import { createFetchTap } from '../connection/tap'
import type { RawResult } from '../connection/types'
import { lintJsonSchema } from '../schema-form'
import type { Check, CheckContext, CheckOutcome } from './types'

// The check catalogue. Every check is a small async function over a connected session; it never
// throws on a server misbehaving (it returns `fail`) and, except for the two named exceptions
// (http.session-delete's throwaway session, the opt-in tools.call-smoke), never changes server state.

/** Per-request timeout; below the runner's 15 s per-check budget so a slow server yields a clear message. */
const REQUEST_TIMEOUT_MS = 12000
const PING_COUNT = 5
const PING_WARN_MEDIAN_MS = 2000
const SMOKE_MAX_TOOLS = 20
export const UNKNOWN_TOOL_NAME = '__conformance_nonexistent_tool__'
export const UNKNOWN_METHOD = 'conformance/unknown-method'
const MAX_LISTED = 10

type Rec = Record<string, unknown>
type Failure = Extract<RawResult, { ok: false }>

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

function hasCap(ctx: CheckContext, key: string): boolean {
  const v = ctx.info.capabilities[key]
  return v !== undefined && v !== null
}

function rpc(ctx: CheckContext, method: string, params?: unknown): Promise<RawResult> {
  return ctx.session.rawRequest(method, params, { signal: ctx.signal, timeoutMs: REQUEST_TIMEOUT_MS })
}

function describeFailure(r: Failure): string {
  return r.error.code === null ? r.error.message : `${r.error.message} (code ${r.error.code})`
}

function pass(message: string, detail?: unknown): CheckOutcome {
  return { status: 'pass', message, ...(detail !== undefined ? { detail } : {}) }
}
function fail(message: string, detail?: unknown): CheckOutcome {
  return { status: 'fail', message, ...(detail !== undefined ? { detail } : {}) }
}
function warn(message: string, detail?: unknown): CheckOutcome {
  return { status: 'warn', message, ...(detail !== undefined ? { detail } : {}) }
}
function skip(message: string): CheckOutcome {
  return { status: 'skip', message }
}

function listed(names: string[]): string {
  const shown = names.slice(0, MAX_LISTED).join(', ')
  return names.length > MAX_LISTED ? `${shown} (+${names.length - MAX_LISTED} more)` : shown
}

/** Strings that must never appear in a result message: configured header values and the session id. */
function secretsOf(ctx: CheckContext): string[] {
  const out = secretFragments(ctx.sessionOptions.config.headers, true)
  if (ctx.info.sessionId) out.push(ctx.info.sessionId)
  return out
}

function define(c: Check): Check {
  return {
    ...c,
    async run(ctx) {
      const outcome = await c.run(ctx)
      return { ...outcome, message: scrubSecrets(outcome.message, secretsOf(ctx)) }
    },
  }
}

// ---------------------------------------------------------------------------
// Paged lists
// ---------------------------------------------------------------------------

interface ListDef {
  kind: 'tools' | 'resources' | 'resourceTemplates' | 'prompts'
  method: string
  key: string
  cap: string
  label: string
  /** Field that must be unique across the list. */
  idField: string
}

const LISTS: ListDef[] = [
  { kind: 'tools', method: 'tools/list', key: 'tools', cap: 'tools', label: 'tools', idField: 'name' },
  { kind: 'resources', method: 'resources/list', key: 'resources', cap: 'resources', label: 'resources', idField: 'uri' },
  {
    kind: 'resourceTemplates',
    method: 'resources/templates/list',
    key: 'resourceTemplates',
    cap: 'resources',
    label: 'resource templates',
    idField: 'uriTemplate',
  },
  { kind: 'prompts', method: 'prompts/list', key: 'prompts', cap: 'prompts', label: 'prompts', idField: 'name' },
]
const LIST_BY_KIND = Object.fromEntries(LISTS.map((l) => [l.kind, l])) as Record<ListDef['kind'], ListDef>
/** Lists walked by the pagination checks (templates are optional within the resources capability, so they are not). */
const PAGED_LISTS = LISTS.filter((l) => l.kind !== 'resourceTemplates')

/** Walks every page of a list once per run (memoised in ctx.cache). */
function loadList(ctx: CheckContext, def: ListDef): Promise<CollectedPages<unknown>> {
  const cacheKey = `list:${def.kind}`
  const hit = ctx.cache.get(cacheKey) as Promise<CollectedPages<unknown>> | undefined
  if (hit) return hit
  const p = collectPages<unknown>(async (cursor) => {
    const r = await rpc(ctx, def.method, cursor === undefined ? undefined : { cursor })
    if (!r.ok) throw new Error(describeFailure(r))
    const items = isRec(r.result) ? r.result[def.key] : undefined
    if (!Array.isArray(items)) throw new Error(`${def.method} result has no "${def.key}" array`)
    const next = (r.result as Rec).nextCursor
    return { items, nextCursor: typeof next === 'string' ? next : undefined }
  })
  ctx.cache.set(cacheKey, p)
  // An aborted run must not poison a later check with a cancelled walk.
  void p.then(() => {
    if (ctx.signal.aborted) ctx.cache.delete(cacheKey)
  })
  return p
}

async function loadTools(ctx: CheckContext): Promise<{ tools: Rec[] } | { outcome: CheckOutcome }> {
  if (!hasCap(ctx, 'tools')) return { outcome: skip('Server does not advertise the tools capability') }
  const res = await loadList(ctx, LIST_BY_KIND.tools)
  if (res.error !== null) return { outcome: fail(`Could not list tools: ${res.error}`) }
  return { tools: res.items.filter(isRec) }
}

// ---------------------------------------------------------------------------
// handshake
// ---------------------------------------------------------------------------

const initializeValid: Check = {
  id: 'handshake.initialize-valid',
  group: 'Handshake',
  title: 'Initialize result is valid',
  spec: 'The negotiated protocol version is one the SDK supports, and server name, version and capabilities are well-formed.',
  defaultOn: true,
  async run(ctx) {
    const problems: string[] = []
    const version = ctx.info.protocolVersion
    if (!(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
      problems.push(`negotiated protocol version "${version}" is not one of ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`)
    }
    // Read the raw values: ServerSummary replaces a blank name/version with a placeholder.
    const server = ctx.session.client.getServerVersion()
    if (!nonEmptyString(server?.name)) problems.push('serverInfo.name is not a non-empty string')
    if (!nonEmptyString(server?.version)) problems.push('serverInfo.version is not a non-empty string')
    const caps: unknown = ctx.session.client.getServerCapabilities()
    if (!isRec(caps)) problems.push('capabilities is not an object')
    if (problems.length > 0) return fail(`Invalid initialize result: ${problems.join('; ')}`, { problems })
    return pass(`Negotiated ${version} with ${server?.name} ${server?.version}`)
  },
}

const ping: Check = {
  id: 'handshake.ping',
  group: 'Handshake',
  title: 'Ping returns an empty result',
  spec: 'ping must be answered with an empty object so clients can use it as a liveness probe.',
  defaultOn: true,
  async run(ctx) {
    const r = await rpc(ctx, 'ping')
    if (!r.ok) return fail(`ping failed: ${describeFailure(r)}`)
    const extra = isRec(r.result) ? Object.keys(r.result).filter((k) => k !== '_meta') : null
    if (extra === null) return fail('ping result is not an object', r.result)
    if (extra.length > 0) return fail(`ping result is not empty (keys: ${extra.join(', ')})`, r.result)
    return pass('ping returned {}')
  },
}

// ---------------------------------------------------------------------------
// capabilities
// ---------------------------------------------------------------------------

const listMatches: Check = {
  id: 'capabilities.list-matches',
  group: 'Capabilities',
  title: 'List methods match advertised capabilities',
  spec: 'Advertised list methods must work; unadvertised ones should answer -32601 Method not found.',
  defaultOn: true,
  async run(ctx) {
    const failures: string[] = []
    const warnings: string[] = []
    for (const def of LISTS) {
      const advertised = hasCap(ctx, def.cap)
      const r = await rpc(ctx, def.method)
      if (advertised) {
        if (r.ok) continue
        // resources/templates/list is optional within the resources capability: a missing method is only a warning.
        if (def.kind === 'resourceTemplates' && r.error.code === -32601) warnings.push(`${def.method} is not implemented`)
        else failures.push(`${def.method} is advertised but failed: ${describeFailure(r)}`)
      } else if (r.ok) {
        warnings.push(`${def.method} works but is not advertised`)
      } else if (r.error.code !== -32601) {
        failures.push(`${def.method} is not advertised and answered ${describeFailure(r)} instead of -32601`)
      }
    }
    if (failures.length > 0) return fail(failures.join('; '), { failures, warnings })
    if (warnings.length > 0) return warn(warnings.join('; '), { warnings })
    return pass('Every list method agrees with the advertised capabilities')
  },
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

const toolsUniqueNames: Check = {
  id: 'tools.unique-names',
  group: 'Tools',
  title: 'Tool names are unique',
  spec: 'Tools are addressed by name, so two tools sharing a name make calls ambiguous.',
  defaultOn: true,
  async run(ctx) {
    const loaded = await loadTools(ctx)
    if ('outcome' in loaded) return loaded.outcome
    const seen = new Set<string>()
    const dupes = new Set<string>()
    for (const t of loaded.tools) {
      const name = typeof t.name === 'string' ? t.name : ''
      if (seen.has(name)) dupes.add(name)
      seen.add(name)
    }
    if (dupes.size > 0) return fail(`Duplicate tool names: ${listed([...dupes])}`, { duplicates: [...dupes] })
    return pass(`${loaded.tools.length} tools, all names unique`)
  },
}

const toolsInputSchema: Check = {
  id: 'tools.input-schema-valid',
  group: 'Tools',
  title: 'Tool input schemas are valid',
  spec: 'inputSchema must be a JSON Schema object (type "object") so clients can build forms and validate arguments.',
  defaultOn: true,
  async run(ctx) {
    const loaded = await loadTools(ctx)
    if ('outcome' in loaded) return loaded.outcome
    const bad: { tool: string; issues: string[] }[] = []
    for (const t of loaded.tools) {
      const issues: string[] = []
      const schema = t.inputSchema
      if (!isRec(schema)) issues.push('inputSchema is missing or not an object')
      else {
        if (schema.type !== 'object') issues.push('inputSchema.type is not "object"')
        for (const i of lintJsonSchema(schema)) issues.push(`${i.path || '(root)'}: ${i.message}`)
      }
      if (issues.length > 0) bad.push({ tool: typeof t.name === 'string' ? t.name : '(unnamed)', issues })
    }
    if (bad.length > 0) return fail(`Invalid inputSchema on: ${listed(bad.map((b) => b.tool))}`, bad)
    return pass(`All ${loaded.tools.length} input schemas are valid`)
  },
}

const toolsOutputSchema: Check = {
  id: 'tools.output-schema-valid',
  group: 'Tools',
  title: 'Tool output schemas are valid',
  spec: 'When a tool declares an outputSchema it must be a valid JSON Schema object.',
  defaultOn: true,
  async run(ctx) {
    const loaded = await loadTools(ctx)
    if ('outcome' in loaded) return loaded.outcome
    const withOutput = loaded.tools.filter((t) => t.outputSchema !== undefined)
    if (withOutput.length === 0) return skip('No tool declares an outputSchema')
    const bad: { tool: string; issues: string[] }[] = []
    for (const t of withOutput) {
      const issues: string[] = []
      const schema = t.outputSchema
      if (!isRec(schema)) issues.push('outputSchema is not an object')
      else {
        if (schema.type !== 'object') issues.push('outputSchema.type is not "object"')
        for (const i of lintJsonSchema(schema)) issues.push(`${i.path || '(root)'}: ${i.message}`)
      }
      if (issues.length > 0) bad.push({ tool: typeof t.name === 'string' ? t.name : '(unnamed)', issues })
    }
    if (bad.length > 0) return fail(`Invalid outputSchema on: ${listed(bad.map((b) => b.tool))}`, bad)
    return pass(`All ${withOutput.length} output schemas are valid`)
  },
}

const toolsDescriptions: Check = {
  id: 'tools.descriptions-present',
  group: 'Tools',
  title: 'Tools have descriptions',
  spec: 'Models and users choose tools from their descriptions; a missing description makes a tool hard to use.',
  defaultOn: true,
  async run(ctx) {
    const loaded = await loadTools(ctx)
    if ('outcome' in loaded) return loaded.outcome
    const missing = loaded.tools.filter((t) => !nonEmptyString(t.description)).map((t) => (typeof t.name === 'string' ? t.name : '(unnamed)'))
    if (missing.length > 0) return warn(`No description on: ${listed(missing)}`, { missing })
    return pass(`All ${loaded.tools.length} tools have a description`)
  },
}

const unknownTool: Check = {
  id: 'tools.unknown-tool-errors',
  group: 'Tools',
  title: 'Calling an unknown tool is an error',
  spec: 'A call to a tool that does not exist must produce a JSON-RPC error or an isError result, never success.',
  defaultOn: true,
  async run(ctx) {
    if (!hasCap(ctx, 'tools')) return skip('Server does not advertise the tools capability')
    const r = await rpc(ctx, 'tools/call', { name: UNKNOWN_TOOL_NAME, arguments: {} })
    if (!r.ok) {
      if (r.error.code === null) return fail(`Request did not complete: ${r.error.message}`)
      return pass(`Rejected with JSON-RPC error ${r.error.code}: ${r.error.message}`)
    }
    if (isRec(r.result) && r.result.isError === true) return pass('Returned a result with isError: true')
    return fail('Calling a non-existent tool succeeded', r.result)
  },
}

const callSmoke: Check = {
  id: 'tools.call-smoke',
  group: 'Tools',
  title: 'Smoke-call read-only tools',
  spec: 'Read-only tools that need no arguments should return content or structuredContent when called with {}.',
  defaultOn: false,
  async run(ctx) {
    const loaded = await loadTools(ctx)
    if ('outcome' in loaded) return loaded.outcome
    const eligible = loaded.tools.filter((t) => {
      if (typeof t.name !== 'string' || !isRec(t.annotations) || t.annotations.readOnlyHint !== true) return false
      const required = isRec(t.inputSchema) ? t.inputSchema.required : undefined
      return !Array.isArray(required) || required.length === 0
    })
    if (eligible.length === 0) return skip('No read-only tool without required arguments')
    const tested = eligible.slice(0, SMOKE_MAX_TOOLS)
    const failures: string[] = []
    const warnings: string[] = []
    for (const t of tested) {
      const name = t.name as string
      const r = await rpc(ctx, 'tools/call', { name, arguments: {} })
      if (!r.ok) {
        failures.push(`${name}: ${describeFailure(r)}`)
        continue
      }
      const res = r.result
      const hasContent = isRec(res) && (Array.isArray(res.content) || isRec(res.structuredContent))
      if (!hasContent) failures.push(`${name}: result has neither content nor structuredContent`)
      else if (isRec(res) && res.isError === true) warnings.push(`${name}: returned isError: true`)
    }
    const note = eligible.length > tested.length ? ` (first ${tested.length} of ${eligible.length})` : ''
    if (failures.length > 0) return fail(`Smoke call failed: ${listed(failures)}`, { failures, warnings })
    if (warnings.length > 0) return warn(`Smoke call returned errors: ${listed(warnings)}`, { warnings })
    return pass(`Called ${tested.length} read-only tools${note}; all returned content`)
  },
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

const unknownMethod: Check = {
  id: 'errors.unknown-method',
  group: 'Errors',
  title: 'Unknown method returns -32601',
  spec: 'JSON-RPC requires "Method not found" (-32601) for methods the server does not implement.',
  defaultOn: true,
  async run(ctx) {
    const r = await rpc(ctx, UNKNOWN_METHOD)
    if (r.ok) return fail('An unknown method succeeded', r.result)
    if (r.error.code === null) return fail(`Request did not complete: ${r.error.message}`)
    if (r.error.code === -32601) return pass('Answered -32601 Method not found')
    return warn(`Answered ${r.error.code} instead of -32601: ${r.error.message}`)
  },
}

const invalidParams: Check = {
  id: 'errors.invalid-params',
  group: 'Errors',
  title: 'Invalid params return -32602',
  spec: 'JSON-RPC requires "Invalid params" (-32602) when a request is missing required parameters.',
  defaultOn: true,
  async run(ctx) {
    if (!hasCap(ctx, 'tools')) return skip('Server does not advertise the tools capability')
    const r = await rpc(ctx, 'tools/call', {})
    if (r.ok) return fail('tools/call without a tool name succeeded', r.result)
    if (r.error.code === null) return fail(`Request did not complete: ${r.error.message}`)
    if (r.error.code === -32602) return pass('Answered -32602 Invalid params')
    return warn(`Answered ${r.error.code} instead of -32602: ${r.error.message}`)
  },
}

// ---------------------------------------------------------------------------
// pagination
// ---------------------------------------------------------------------------

const paginationTerminates: Check = {
  id: 'pagination.terminates',
  group: 'Pagination',
  title: 'Pagination terminates',
  spec: 'Following nextCursor must end; a repeated cursor or an endless list makes clients hang.',
  defaultOn: true,
  async run(ctx) {
    const advertised = PAGED_LISTS.filter((d) => hasCap(ctx, d.cap))
    if (advertised.length === 0) return skip('Server advertises no list capability')
    const problems: string[] = []
    const counts: string[] = []
    for (const def of advertised) {
      const res = await loadList(ctx, def)
      if (res.reason === 'cursor-loop') problems.push(`${def.method} repeats a cursor (loop)`)
      else if (res.reason === 'max-pages') problems.push(`${def.method} did not finish within the page limit`)
      else if (res.error !== null) problems.push(`${def.method} failed: ${res.error}`)
      else counts.push(`${res.items.length} ${def.label}`)
    }
    if (problems.length > 0) return fail(problems.join('; '), { problems })
    return pass(`Every list ended: ${counts.join(', ')}`)
  },
}

const paginationNoDuplicates: Check = {
  id: 'pagination.no-duplicates',
  group: 'Pagination',
  title: 'Pages contain no duplicates',
  spec: 'Items repeated across pages mean the server mishandles cursors and clients show or process items twice.',
  defaultOn: true,
  async run(ctx) {
    const advertised = PAGED_LISTS.filter((d) => hasCap(ctx, d.cap))
    if (advertised.length === 0) return skip('Server advertises no list capability')
    const problems: string[] = []
    for (const def of advertised) {
      const res = await loadList(ctx, def)
      if (res.error !== null) {
        problems.push(`${def.method} failed: ${res.error}`)
        continue
      }
      const seen = new Set<string>()
      const dupes = new Set<string>()
      for (const item of res.items) {
        const id = isRec(item) && typeof item[def.idField] === 'string' ? (item[def.idField] as string) : null
        if (id === null) continue
        if (seen.has(id)) dupes.add(id)
        seen.add(id)
      }
      if (dupes.size > 0) problems.push(`${def.method} repeats ${def.idField}: ${listed([...dupes])}`)
    }
    if (problems.length > 0) return fail(problems.join('; '), { problems })
    return pass('No duplicate items across pages')
  },
}

// ---------------------------------------------------------------------------
// resources / prompts
// ---------------------------------------------------------------------------

async function loadResources(ctx: CheckContext): Promise<{ items: unknown[] } | { outcome: CheckOutcome }> {
  if (!hasCap(ctx, 'resources')) return { outcome: skip('Server does not advertise the resources capability') }
  const res = await loadList(ctx, LIST_BY_KIND.resources)
  if (res.error !== null) return { outcome: fail(`Could not list resources: ${res.error}`) }
  return { items: res.items }
}

const resourcesShape: Check = {
  id: 'resources.shape',
  group: 'Resources',
  title: 'Resources have uri and name',
  spec: 'Every listed resource needs a string uri (to read it) and a string name (to show it).',
  defaultOn: true,
  async run(ctx) {
    const loaded = await loadResources(ctx)
    if ('outcome' in loaded) return loaded.outcome
    const bad = loaded.items.flatMap((r, i) =>
      isRec(r) && typeof r.uri === 'string' && typeof r.name === 'string' ? [] : [isRec(r) && typeof r.uri === 'string' ? r.uri : `#${i}`],
    )
    if (bad.length > 0) return fail(`Resources missing a string uri or name: ${listed(bad)}`, { bad })
    return pass(`All ${loaded.items.length} resources have uri and name`)
  },
}

const resourcesReadMatches: Check = {
  id: 'resources.read-matches',
  group: 'Resources',
  title: 'Reading a resource returns well-formed contents',
  spec: 'resources/read must return contents whose items have a uri and exactly one of text or blob.',
  defaultOn: true,
  async run(ctx) {
    const loaded = await loadResources(ctx)
    if ('outcome' in loaded) return loaded.outcome
    const first = loaded.items.find((r) => isRec(r) && typeof r.uri === 'string') as Rec | undefined
    if (!first) return skip('Server lists no resources')
    const uri = first.uri as string
    const r = await rpc(ctx, 'resources/read', { uri })
    if (!r.ok) return fail(`resources/read failed for ${uri}: ${describeFailure(r)}`)
    const contents = isRec(r.result) ? r.result.contents : undefined
    if (!Array.isArray(contents)) return fail(`resources/read result for ${uri} has no contents array`, r.result)
    const problems: string[] = []
    contents.forEach((c, i) => {
      if (!isRec(c)) return void problems.push(`contents[${i}] is not an object`)
      if (typeof c.uri !== 'string') problems.push(`contents[${i}] has no string uri`)
      const hasText = typeof c.text === 'string'
      const hasBlob = typeof c.blob === 'string'
      if (hasText === hasBlob) problems.push(`contents[${i}] must have exactly one of text or blob`)
    })
    if (problems.length > 0) return fail(`Malformed contents for ${uri}: ${problems.join('; ')}`, { problems })
    return pass(`Read ${uri}: ${contents.length} content item(s) well-formed`)
  },
}

async function loadPrompts(ctx: CheckContext): Promise<{ items: unknown[] } | { outcome: CheckOutcome }> {
  if (!hasCap(ctx, 'prompts')) return { outcome: skip('Server does not advertise the prompts capability') }
  const res = await loadList(ctx, LIST_BY_KIND.prompts)
  if (res.error !== null) return { outcome: fail(`Could not list prompts: ${res.error}`) }
  return { items: res.items }
}

const promptsShape: Check = {
  id: 'prompts.shape',
  group: 'Prompts',
  title: 'Prompts have a name',
  spec: 'Prompts are fetched by name, so every listed prompt needs a string name.',
  defaultOn: true,
  async run(ctx) {
    const loaded = await loadPrompts(ctx)
    if ('outcome' in loaded) return loaded.outcome
    const bad = loaded.items.flatMap((p, i) => (isRec(p) && typeof p.name === 'string' ? [] : [`#${i}`]))
    if (bad.length > 0) return fail(`Prompts without a string name: ${listed(bad)}`, { bad })
    return pass(`All ${loaded.items.length} prompts have a name`)
  },
}

const promptsMissingArg: Check = {
  id: 'prompts.missing-required-arg',
  group: 'Prompts',
  title: 'Missing required prompt argument is an error',
  spec: 'prompts/get without a required argument must fail instead of returning a half-filled prompt.',
  defaultOn: true,
  async run(ctx) {
    const loaded = await loadPrompts(ctx)
    if ('outcome' in loaded) return loaded.outcome
    const target = loaded.items.find(
      (p): p is Rec =>
        isRec(p) && typeof p.name === 'string' && Array.isArray(p.arguments) && p.arguments.some((a) => isRec(a) && a.required === true),
    )
    if (!target) return skip('No prompt declares a required argument')
    const name = target.name as string
    const r = await rpc(ctx, 'prompts/get', { name, arguments: {} })
    if (r.ok) return fail(`prompts/get for "${name}" succeeded without its required argument`, r.result)
    if (r.error.code === null) return fail(`Request did not complete: ${r.error.message}`)
    return pass(`"${name}" rejected the call with error ${r.error.code}`)
  },
}

// ---------------------------------------------------------------------------
// http (streamable-http only)
// ---------------------------------------------------------------------------

interface HttpBase {
  url: string
  doFetch: typeof fetch
  headers: Record<string, string>
}

function httpBase(ctx: CheckContext): HttpBase {
  const { config, fetchImpl } = ctx.sessionOptions
  const headers: Record<string, string> = {}
  for (const h of config.headers) headers[h.name] = h.value
  const raw: typeof fetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  // When the tab provides a log sink, these probe requests appear in the Log drawer (redacted by the tap).
  const doFetch = ctx.onLog
    ? createFetchTap({
        fetch: raw,
        onLog: ctx.onLog,
        now: Date.now,
        secretHeaderNames: config.headers.map((h) => h.name),
        secretFragments: secretFragments(config.headers, true),
      })
    : raw
  return { url: config.url, doFetch, headers }
}

function httpSkipReason(ctx: CheckContext): string | null {
  if (ctx.info.transport !== 'streamable-http') return 'Only applies to the Streamable HTTP transport'
  if (!ctx.sessionOptions.fetchImpl && typeof globalThis.fetch !== 'function') return 'No fetch implementation available'
  return null
}

async function drain(res: Response): Promise<void> {
  try {
    await res.body?.cancel()
  } catch {
    // body already consumed or not cancellable
  }
}

const notification202: Check = {
  id: 'http.notification-202',
  group: 'HTTP',
  title: 'Notifications are answered 202',
  spec: 'A POSTed JSON-RPC notification must be acknowledged with 202 Accepted and no body.',
  defaultOn: true,
  async run(ctx) {
    const reason = httpSkipReason(ctx)
    if (reason) return skip(reason)
    if (ctx.sessionOptions.authProvider) return skip('OAuth profiles are not supported by this check')
    const sessionId = ctx.info.sessionId
    if (!sessionId) return skip('The server issued no session id')
    const base = httpBase(ctx)
    let status: number
    try {
      const res = await base.doFetch(base.url, {
        method: 'POST',
        headers: {
          ...base.headers,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId,
          'mcp-protocol-version': ctx.info.protocolVersion,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        signal: ctx.signal,
      })
      status = res.status
      await drain(res)
    } catch (e) {
      return fail(`Request failed: ${errorMessage(e)}`)
    }
    if (status === 202) return pass('POST notification answered 202 Accepted')
    if (status === 200 || status === 204) return warn(`POST notification answered ${status}; the spec requires 202 Accepted`)
    return fail(`POST notification answered ${status}; expected 202 Accepted`)
  },
}

const sessionDelete: Check = {
  id: 'http.session-delete',
  group: 'HTTP',
  title: 'Session termination works',
  spec: 'DELETE on the endpoint ends a session (or answers 405), and the ended session id is then rejected with 404.',
  defaultOn: true,
  async run(ctx) {
    const reason = httpSkipReason(ctx)
    if (reason) return skip(reason)
    // A throwaway session would reuse the auth provider and could open an authorization popup.
    if (ctx.sessionOptions.authProvider) return skip('OAuth profiles are not supported by this check')
    const base = httpBase(ctx)

    // clientSetup is shared with the main session; leaving it out keeps dispose() from touching it.
    const throwaway = createSession({ ...ctx.sessionOptions, clientSetup: undefined, onLog: ctx.onLog ?? (() => undefined), onState: () => undefined })
    try {
      const state = await throwaway.connect()
      if (state.status !== 'connected') {
        return fail(`Could not open a throwaway session (${state.status === 'error' ? state.diagnosis.title : state.status})`)
      }
      const sessionId = state.info.sessionId
      if (!sessionId) return skip('The server issued no session id')
      const protocolVersion = state.info.protocolVersion
      const sessionHeaders = { ...base.headers, 'mcp-session-id': sessionId, 'mcp-protocol-version': protocolVersion }

      let deleteStatus: number
      try {
        const res = await base.doFetch(base.url, { method: 'DELETE', headers: sessionHeaders, signal: ctx.signal })
        deleteStatus = res.status
        await drain(res)
      } catch (e) {
        return fail(`DELETE failed: ${scrubSecrets(errorMessage(e), [sessionId])}`)
      }
      if (deleteStatus === 405) return pass('Server does not allow client session termination')
      if (deleteStatus !== 200 && deleteStatus !== 204) return fail(`DELETE answered ${deleteStatus}; expected 200, 204 or 405`)

      let pingStatus: number
      try {
        const res = await base.doFetch(base.url, {
          method: 'POST',
          headers: { ...sessionHeaders, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
          signal: ctx.signal,
        })
        pingStatus = res.status
        await drain(res)
      } catch (e) {
        return warn(`Session ended (DELETE ${deleteStatus}), but the follow-up ping failed: ${scrubSecrets(errorMessage(e), [sessionId])}`)
      }
      if (pingStatus === 404) return pass(`Session ended (DELETE ${deleteStatus}) and the dead session id is rejected with 404`)
      return warn(`Session ended (DELETE ${deleteStatus}), but a request with the dead session id answered ${pingStatus} instead of 404`)
    } finally {
      await throwaway.disconnect().catch(() => undefined)
    }
  },
}

// ---------------------------------------------------------------------------
// performance
// ---------------------------------------------------------------------------

const pingLatency: Check = {
  id: 'perf.ping-latency',
  group: 'Performance',
  title: 'Ping latency',
  spec: 'Five sequential pings measure round-trip time; a slow median hints at an overloaded or distant server.',
  defaultOn: true,
  async run(ctx) {
    const times: number[] = []
    for (let i = 0; i < PING_COUNT; i++) {
      const r = await rpc(ctx, 'ping')
      if (!r.ok) return fail(`ping ${i + 1}/${PING_COUNT} failed: ${describeFailure(r)}`)
      times.push(r.durationMs)
    }
    const sorted = [...times].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const message = `min ${sorted[0]} ms / median ${median} ms / max ${sorted[sorted.length - 1]} ms over ${PING_COUNT} pings`
    const detail = { timesMs: times }
    if (median > PING_WARN_MEDIAN_MS) return warn(`Slow: ${message}`, detail)
    return { status: 'info', message, detail }
  },
}

/** The catalogue in display order. */
export const CHECKS: Check[] = [
  initializeValid,
  ping,
  listMatches,
  toolsUniqueNames,
  toolsInputSchema,
  toolsOutputSchema,
  toolsDescriptions,
  unknownTool,
  unknownMethod,
  invalidParams,
  paginationTerminates,
  paginationNoDuplicates,
  resourcesShape,
  resourcesReadMatches,
  promptsShape,
  promptsMissingArg,
  notification202,
  sessionDelete,
  pingLatency,
  callSmoke,
].map(define)

export const CALL_SMOKE_LABEL = 'Calls read-only tools that need no arguments'

export function getCheck(id: string): Check | undefined {
  return CHECKS.find((c) => c.id === id)
}

/** Checks grouped by `group`, in catalogue order. */
export function groupChecks(checks: Check[] = CHECKS): { group: string; checks: Check[] }[] {
  const groups: { group: string; checks: Check[] }[] = []
  for (const c of checks) {
    const g = groups.find((x) => x.group === c.group)
    if (g) g.checks.push(c)
    else groups.push({ group: c.group, checks: [c] })
  }
  return groups
}

export function defaultSelection(checks: Check[] = CHECKS): Set<string> {
  return new Set(checks.filter((c) => c.defaultOn).map((c) => c.id))
}
