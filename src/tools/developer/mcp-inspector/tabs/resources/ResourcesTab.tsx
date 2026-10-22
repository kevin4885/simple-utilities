import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { collectPages } from '../../connection/logic'
import type { McpSession } from '../../connection/session'
import { useMcpInspectorStore } from '../../store'
import { ContentView, formatBytes } from '../../shell/ContentView'
import type { TabProps } from '../../shell/logic'
import { base64ByteLength, cleanBase64 } from '../../shell/viewerIo'
import { expandUriTemplate, extractTemplateVariables } from './uriTemplate'

// Everything the server sends (names, descriptions, URIs, contents) is rendered as React text children only.
// Server-supplied URIs are never fetched or opened: they are only ever sent back to the same server.

type Rec = Record<string, unknown>

interface ResourceItem {
  uri: string
  name: string
  title: string | null
  description: string | null
  mimeType: string | null
}

interface TemplateItem {
  uriTemplate: string
  name: string
  title: string | null
  description: string | null
  mimeType: string | null
}

type ListState<T> =
  | { status: 'loading' }
  | { status: 'ready'; items: T[]; note: string | null }
  | { status: 'error'; message: string }

type ReadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; uri: string; contents: unknown[] }
  | { status: 'error'; code: number | null; message: string }

type Selection = { kind: 'resource'; uri: string } | { kind: 'template'; uriTemplate: string } | null

const COMPLETION_DEBOUNCE_MS = 300
const MAX_SUGGESTIONS = 10

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const optStr = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

function toResource(v: unknown): ResourceItem | null {
  if (!isRec(v) || typeof v.uri !== 'string') return null
  return {
    uri: v.uri,
    name: optStr(v.name) ?? v.uri,
    title: optStr(v.title),
    description: optStr(v.description),
    mimeType: optStr(v.mimeType),
  }
}

function toTemplate(v: unknown): TemplateItem | null {
  if (!isRec(v) || typeof v.uriTemplate !== 'string') return null
  return {
    uriTemplate: v.uriTemplate,
    name: optStr(v.name) ?? v.uriTemplate,
    title: optStr(v.title),
    description: optStr(v.description),
    mimeType: optStr(v.mimeType),
  }
}

async function loadAll<T>(
  session: McpSession,
  method: string,
  key: string,
  convert: (v: unknown) => T | null,
): Promise<ListState<T>> {
  const r = await collectPages<unknown>(async (cursor) => {
    const res = await session.rawRequest(method, cursor ? { cursor } : {})
    if (!res.ok) throw new Error(res.error.message)
    const body = isRec(res.result) ? res.result : {}
    return {
      items: Array.isArray(body[key]) ? (body[key] as unknown[]) : [],
      nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : undefined,
    }
  })
  if (r.error !== null) return { status: 'error', message: r.error }
  const items = r.items.map(convert).filter((x): x is T => x !== null)
  return {
    status: 'ready',
    items,
    note: r.truncated ? `List truncated (${r.reason === 'cursor-loop' ? 'the server repeated a page cursor' : 'page limit reached'}).` : null,
  }
}

function matches(query: string, ...fields: (string | null)[]): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || fields.some((f) => f !== null && f.toLowerCase().includes(q))
}

function describeContent(entry: unknown): string | null {
  if (!isRec(entry)) return null
  const mime = typeof entry.mimeType === 'string' && entry.mimeType !== '' ? entry.mimeType : 'unknown mime type'
  if (typeof entry.text === 'string') return `${mime} · ${entry.text.length} chars`
  if (typeof entry.blob === 'string') {
    const clean = cleanBase64(entry.blob)
    return `${mime} · ${clean === null ? 'invalid binary data' : formatBytes(base64ByteLength(clean))}`
  }
  return null
}

function ProtocolError({ code, message }: { code: number | null; message: string }) {
  return (
    <div role="alert" className="rounded-md border border-destructive/50 p-3 text-sm">
      <div className="font-medium text-destructive">{code === null ? 'Request failed' : 'Protocol error'}</div>
      {code !== null && <div className="font-mono text-xs">Code {code}</div>}
      <div className="break-words whitespace-pre-wrap">{message}</div>
    </div>
  )
}

function ListMessage({
  state,
  empty,
  onRetry,
}: {
  state: ListState<unknown>
  empty: string
  onRetry: () => void
}) {
  if (state.status === 'loading') return <p className="text-sm text-muted-foreground">Loading…</p>
  if (state.status === 'error') {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm break-words text-destructive">
          {state.message}
        </p>
        <Button type="button" variant="outline" size="xs" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  }
  if (state.items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return null
}

const ResourcesTab: ComponentType<TabProps> = ({ session, info, profileId }) => {
  const pushHistory = useMcpInspectorStore((s) => s.pushHistory)
  const resourcesCap = isRec(info.capabilities.resources) ? info.capabilities.resources : {}
  const canSubscribe = resourcesCap.subscribe === true
  const canComplete = hasOwn(info.capabilities, 'completions')

  const [resources, setResources] = useState<ListState<ResourceItem>>({ status: 'loading' })
  const [templates, setTemplates] = useState<ListState<TemplateItem>>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<Selection>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [read, setRead] = useState<ReadState>({ status: 'idle' })
  const [subscribed, setSubscribed] = useState<ReadonlySet<string>>(new Set())
  const [updated, setUpdated] = useState<ReadonlySet<string>>(new Set())
  const [subError, setSubError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({})

  const mounted = useRef(true)
  const listSeq = useRef(0)
  const readSeq = useRef(0)
  const subs = useRef(new Set<string>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const completionSeq = useRef(new Map<string, number>())

  const refresh = useCallback(async () => {
    const seq = ++listSeq.current
    const [r, t] = await Promise.all([
      loadAll(session, 'resources/list', 'resources', toResource),
      loadAll(session, 'resources/templates/list', 'resourceTemplates', toTemplate),
    ])
    if (!mounted.current || seq !== listSeq.current) return
    setResources(r)
    setTemplates(t)
  }, [session])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const off = session.onNotification('notifications/resources/list_changed', () => void refresh())
    return () => {
      off()
    }
  }, [session, refresh])

  useEffect(() => {
    const off = session.onNotification('notifications/resources/updated', (params) => {
      const uri = isRec(params) ? params.uri : undefined
      if (typeof uri !== 'string' || !subs.current.has(uri)) return
      setUpdated((prev) => new Set(prev).add(uri))
    })
    return off
  }, [session])

  // Leaving the tab unsubscribes everything that is still active.
  useEffect(() => {
    const active = subs.current
    const pending = timers.current
    return () => {
      mounted.current = false
      for (const t of pending.values()) clearTimeout(t)
      pending.clear()
      for (const uri of active) void session.rawRequest('resources/unsubscribe', { uri })
      active.clear()
    }
  }, [session])

  const selectedTemplate = useMemo(
    () =>
      selection?.kind === 'template' && templates.status === 'ready'
        ? (templates.items.find((t) => t.uriTemplate === selection.uriTemplate) ?? null)
        : null,
    [selection, templates],
  )
  const selectedResource = useMemo(
    () =>
      selection?.kind === 'resource' && resources.status === 'ready'
        ? (resources.items.find((r) => r.uri === selection.uri) ?? null)
        : null,
    [selection, resources],
  )
  const variables = useMemo(() => (selectedTemplate ? extractTemplateVariables(selectedTemplate.uriTemplate) : []), [selectedTemplate])
  const expansion = useMemo(
    () => (selectedTemplate ? expandUriTemplate(selectedTemplate.uriTemplate, values) : null),
    [selectedTemplate, values],
  )

  /** The uri a Read / Subscribe acts on, or null while the selection is unusable. */
  const targetUri: string | null = selectedResource
    ? selectedResource.uri
    : expansion && expansion.ok && expansion.missing.length === 0
      ? expansion.uri
      : null

  const select = (next: Selection) => {
    readSeq.current++
    setSelection(next)
    setValues({})
    setSuggestions({})
    setRead({ status: 'idle' })
    setSubError(null)
    for (const t of timers.current.values()) clearTimeout(t)
    timers.current.clear()
  }

  const doRead = async (uri: string) => {
    const seq = ++readSeq.current
    setRead({ status: 'loading' })
    const res = await session.rawRequest('resources/read', { uri })
    pushHistory({
      profileId,
      kind: 'resource',
      name: uri,
      argsJson: JSON.stringify({ uri }),
      ok: res.ok,
      durationMs: res.durationMs,
    })
    if (!mounted.current || seq !== readSeq.current) return
    if (!res.ok) {
      setRead({ status: 'error', code: res.error.code, message: res.error.message })
      return
    }
    const contents = isRec(res.result) && Array.isArray(res.result.contents) ? (res.result.contents as unknown[]) : []
    setRead({ status: 'done', uri, contents })
    setUpdated((prev) => {
      if (!prev.has(uri)) return prev
      const next = new Set(prev)
      next.delete(uri)
      return next
    })
  }

  const subscribe = async (uri: string) => {
    setSubError(null)
    const res = await session.rawRequest('resources/subscribe', { uri })
    if (!mounted.current) return
    if (!res.ok) {
      setSubError(res.error.message)
      return
    }
    subs.current.add(uri)
    setSubscribed(new Set(subs.current))
  }

  const unsubscribe = async (uri: string) => {
    setSubError(null)
    const res = await session.rawRequest('resources/unsubscribe', { uri })
    if (!mounted.current) return
    if (!res.ok) {
      setSubError(res.error.message)
      return
    }
    subs.current.delete(uri)
    setSubscribed(new Set(subs.current))
    setUpdated((prev) => {
      const next = new Set(prev)
      next.delete(uri)
      return next
    })
  }

  const onVariableChange = (template: string, name: string, value: string) => {
    const nextValues = { ...values, [name]: value }
    setValues(nextValues)
    if (!canComplete) return
    const existing = timers.current.get(name)
    if (existing) clearTimeout(existing)
    const seq = (completionSeq.current.get(name) ?? 0) + 1
    completionSeq.current.set(name, seq)
    if (value === '') {
      setSuggestions((s) => ({ ...s, [name]: [] }))
      return
    }
    timers.current.set(
      name,
      setTimeout(() => {
        timers.current.delete(name)
        const others: Record<string, string> = {}
        for (const [k, v] of Object.entries(nextValues)) if (k !== name && v !== '') others[k] = v
        void session
          .rawRequest('completion/complete', {
            ref: { type: 'ref/resource', uri: template },
            argument: { name, value },
            ...(Object.keys(others).length > 0 ? { context: { arguments: others } } : {}),
          })
          .then((res) => {
            if (!mounted.current || completionSeq.current.get(name) !== seq) return
            const completion = res.ok && isRec(res.result) && isRec(res.result.completion) ? res.result.completion : null
            const list = completion && Array.isArray(completion.values) ? completion.values : []
            setSuggestions((s) => ({
              ...s,
              [name]: list.filter((x): x is string => typeof x === 'string').slice(0, MAX_SUGGESTIONS),
            }))
          })
      }, COMPLETION_DEBOUNCE_MS),
    )
  }

  const visibleResources = resources.status === 'ready' ? resources.items.filter((r) => matches(query, r.name, r.title, r.uri)) : []
  const visibleTemplates =
    templates.status === 'ready' ? templates.items.filter((t) => matches(query, t.name, t.title, t.uriTemplate)) : []

  const retry = () => {
    setResources({ status: 'loading' })
    setTemplates({ status: 'loading' })
    void refresh()
  }

  const targetSubscribed = targetUri !== null && subscribed.has(targetUri)
  const targetUpdated = targetUri !== null && updated.has(targetUri)
  const detailTitle = selectedResource
    ? (selectedResource.title ?? selectedResource.name)
    : selectedTemplate
      ? (selectedTemplate.title ?? selectedTemplate.name)
      : null
  const detailItem = selectedResource ?? selectedTemplate

  return (
    <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <Input
          type="search"
          aria-label="Search resources"
          placeholder="Search by name or URI"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <section aria-label="Resources" className="space-y-2">
          <h3 className="text-sm font-medium">Resources</h3>
          <ListMessage state={resources} empty="No resources." onRetry={retry} />
          {resources.status === 'ready' && resources.note && <p className="text-xs text-muted-foreground">{resources.note}</p>}
          {resources.status === 'ready' && resources.items.length > 0 && visibleResources.length === 0 && (
            <p className="text-sm text-muted-foreground">No matching resources.</p>
          )}
          <ul className="max-h-96 space-y-1 overflow-auto">
            {visibleResources.map((r) => (
              <li key={r.uri}>
                <button
                  type="button"
                  aria-pressed={selection?.kind === 'resource' && selection.uri === r.uri}
                  onClick={() => select({ kind: 'resource', uri: r.uri })}
                  className="w-full rounded-md border p-2 text-left text-sm hover:bg-accent aria-pressed:bg-accent"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-words">{r.title ?? r.name}</span>
                    {updated.has(r.uri) && <Badge variant="secondary">Updated</Badge>}
                  </span>
                  {r.title && <span className="block text-xs break-words text-muted-foreground">{r.name}</span>}
                  <span className="block font-mono text-xs break-all text-muted-foreground">{r.uri}</span>
                  {r.mimeType && <span className="block text-xs text-muted-foreground">{r.mimeType}</span>}
                  {r.description && <span className="block text-xs break-words text-muted-foreground">{r.description}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Resource templates" className="space-y-2">
          <h3 className="text-sm font-medium">Resource templates</h3>
          <ListMessage state={templates} empty="No resource templates." onRetry={retry} />
          {templates.status === 'ready' && templates.note && <p className="text-xs text-muted-foreground">{templates.note}</p>}
          <ul className="max-h-96 space-y-1 overflow-auto">
            {visibleTemplates.map((t) => (
              <li key={t.uriTemplate}>
                <button
                  type="button"
                  aria-pressed={selection?.kind === 'template' && selection.uriTemplate === t.uriTemplate}
                  onClick={() => select({ kind: 'template', uriTemplate: t.uriTemplate })}
                  className="w-full rounded-md border p-2 text-left text-sm hover:bg-accent aria-pressed:bg-accent"
                >
                  <span className="block font-medium break-words">{t.title ?? t.name}</span>
                  <span className="block font-mono text-xs break-all text-muted-foreground">{t.uriTemplate}</span>
                  {t.mimeType && <span className="block text-xs text-muted-foreground">{t.mimeType}</span>}
                  {t.description && <span className="block text-xs break-words text-muted-foreground">{t.description}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="min-w-0 space-y-3">
        {!detailItem ? (
          <p className="text-sm text-muted-foreground">Select a resource or template.</p>
        ) : (
          <>
            <div>
              <h3 className="font-medium break-words">{detailTitle}</h3>
              {detailItem.description && <p className="text-sm break-words text-muted-foreground">{detailItem.description}</p>}
            </div>

            {selectedTemplate && (
              <div className="space-y-3">
                {variables.map((v) => (
                  <div key={v} className="space-y-1">
                    <Label htmlFor={`rt-var-${v}`}>{v}</Label>
                    <Input
                      id={`rt-var-${v}`}
                      value={values[v] ?? ''}
                      autoComplete="off"
                      onChange={(e) => onVariableChange(selectedTemplate.uriTemplate, v, e.target.value)}
                    />
                    {(suggestions[v]?.length ?? 0) > 0 && (
                      <ul aria-label={`Suggestions for ${v}`} className="flex flex-wrap gap-1">
                        {suggestions[v].map((s) => (
                          <li key={s}>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => onVariableChange(selectedTemplate.uriTemplate, v, s)}
                            >
                              {s}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                <div className="space-y-1">
                  <div className="text-xs font-medium">Expanded URI</div>
                  {expansion && expansion.ok ? (
                    <>
                      <div data-testid="expanded-uri" className="font-mono text-sm break-all">
                        {expansion.uri}
                      </div>
                      {expansion.missing.length > 0 && (
                        <p className="text-xs text-muted-foreground">Missing: {expansion.missing.join(', ')}</p>
                      )}
                    </>
                  ) : (
                    <p role="alert" className="text-sm text-destructive">
                      {expansion && !expansion.ok ? expansion.error : ''}
                    </p>
                  )}
                </div>
              </div>
            )}

            {selectedResource && <div className="font-mono text-xs break-all text-muted-foreground">{selectedResource.uri}</div>}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" disabled={targetUri === null || read.status === 'loading'} onClick={() => targetUri && void doRead(targetUri)}>
                Read
              </Button>
              {canSubscribe && targetUri !== null && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void (targetSubscribed ? unsubscribe(targetUri) : subscribe(targetUri))}
                >
                  {targetSubscribed ? 'Unsubscribe' : 'Subscribe'}
                </Button>
              )}
              {targetUpdated && targetUri !== null && (
                <>
                  <Badge variant="secondary">Updated</Badge>
                  <Button type="button" variant="outline" size="sm" onClick={() => void doRead(targetUri)}>
                    Re-read
                  </Button>
                </>
              )}
            </div>
            {subError && (
              <p role="alert" className="text-sm break-words text-destructive">
                {subError}
              </p>
            )}

            {read.status === 'loading' && <p className="text-sm text-muted-foreground">Reading…</p>}
            {read.status === 'error' && <ProtocolError code={read.code} message={read.message} />}
            {read.status === 'done' && (
              <div className="space-y-2">
                <div className="font-mono text-xs break-all text-muted-foreground">{read.uri}</div>
                <ul className="text-xs text-muted-foreground">
                  {read.contents.map((c, i) => {
                    const d = describeContent(c)
                    return d ? <li key={i}>{d}</li> : null
                  })}
                </ul>
                <ContentView resourceContents={read.contents} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default ResourcesTab
