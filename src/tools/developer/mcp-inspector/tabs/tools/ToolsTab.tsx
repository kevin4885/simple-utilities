import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { collectPages } from '../../connection/logic'
import { toArguments, type FieldError } from '../../schema-form'
import { useMcpInspectorStore } from '../../store'
import { ContentView } from '../../shell/ContentView'
import { JsonView } from '../../shell/JsonView'
import type { TabProps } from '../../shell/logic'
import { ToolForm } from './ToolForm'
import {
  ANY_RESULT,
  annotationBadges,
  argsPreview,
  checkOutputSchema,
  classifyCallError,
  classifyCallResult,
  clampTimeoutMs,
  countLabel,
  DEFAULT_TIMEOUT_MS,
  filterTools,
  initialDraft,
  isDestructive,
  loadHistoryArgs,
  parseArgsText,
  parseToolsPage,
  progressView,
  switchMode,
  toolHistory,
  toolLabel,
  truncationNotice,
  type CallOutcome,
  type McpTool,
  type ProgressView,
  type ToolDraft,
} from './logic'

// Everything the server supplies (names, titles, descriptions, results, errors) is rendered as React text
// children; nothing is interpreted as HTML.

interface ListState {
  loading: boolean
  tools: McpTool[]
  truncated: boolean
  reason: 'max-pages' | 'cursor-loop' | null
  error: string | null
}

/** Editing state of one tool, kept while the user looks at other tools. */
interface Entry {
  schemaKey: string
  draft: ToolDraft
  formErrors: FieldError[]
  switchErrors: FieldError[]
  notice: string | null
}

type CallState =
  | { status: 'idle' }
  | { status: 'running'; toolName: string; progress: ProgressView | null }
  | { status: 'done'; toolName: string; outcome: CallOutcome; durationMs: number; tool: McpTool }

interface PendingCall {
  tool: McpTool
  args: Record<string, unknown>
}

const schemaKeyOf = (tool: McpTool): string => {
  try {
    return JSON.stringify(tool.inputSchema)
  } catch {
    return ''
  }
}

function freshEntry(tool: McpTool): Entry {
  return { schemaKey: schemaKeyOf(tool), draft: initialDraft(tool), formErrors: [], switchErrors: [], notice: null }
}

function BannerShell({ children, tone = 'error' }: { children: React.ReactNode; tone?: 'error' | 'neutral' }) {
  return (
    <div
      role="alert"
      className={cn(
        'space-y-1 rounded-md border p-3 text-sm',
        tone === 'error' ? 'border-destructive/50 text-destructive' : 'border-border text-foreground',
      )}
    >
      {children}
    </div>
  )
}

function ResultPanel({ call, check }: { call: Extract<CallState, { status: 'done' }>; check: ReturnType<typeof checkOutputSchema> }) {
  const { outcome } = call
  const result = outcome.kind === 'success' || outcome.kind === 'tool-error' ? outcome.result : null
  const content = result && Array.isArray(result.content) ? result.content : null
  const structured = result ? result.structuredContent : undefined

  return (
    <section aria-label="Result" className="flex flex-col gap-3" data-testid="tool-result">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Result</h3>
        <span className="ml-auto text-xs text-muted-foreground" data-testid="duration">{`${call.durationMs} ms`}</span>
      </div>

      {outcome.kind === 'tool-error' && (
        <BannerShell>
          <p className="font-medium">Tool returned an error</p>
          <p className="text-xs">The tool ran but reported a failure (isError: true). Its content is shown below.</p>
        </BannerShell>
      )}
      {outcome.kind === 'protocol-error' && (
        <BannerShell>
          <p className="font-medium">Protocol error</p>
          <p className="text-xs">The server answered with a JSON-RPC error.</p>
          <p className="font-mono text-xs break-words">{`code: ${outcome.error.code}`}</p>
          <p className="font-mono text-xs break-words">{`message: ${outcome.error.message}`}</p>
          {outcome.error.data !== undefined && (
            <div className="text-foreground">
              <p className="font-mono text-xs text-destructive">data:</p>
              <JsonView value={outcome.error.data} />
            </div>
          )}
        </BannerShell>
      )}
      {outcome.kind === 'timeout' && (
        <BannerShell>
          <p className="font-medium">{`Timed out after ${outcome.timeoutMs} ms`}</p>
          <p className="text-xs">No response arrived in time. The server may still be working on the request.</p>
        </BannerShell>
      )}
      {outcome.kind === 'cancelled' && (
        <BannerShell tone="neutral">
          <p className="font-medium">Cancelled</p>
          <p className="text-xs">The call was aborted by you. The server was told to stop, but may have finished anyway.</p>
        </BannerShell>
      )}
      {outcome.kind === 'failed' && (
        <BannerShell>
          <p className="font-medium">Call failed</p>
          <p className="text-xs break-words">{outcome.message}</p>
        </BannerShell>
      )}

      {result && content && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">Content</h4>
          <ContentView blocks={content} />
        </div>
      )}
      {result && !content && structured === undefined && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">Raw result</h4>
          <JsonView value={result} />
        </div>
      )}
      {structured !== undefined && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">Structured content</h4>
          <JsonView value={structured} />
        </div>
      )}

      {check.status === 'valid' && (
        <p role="status" className="text-xs text-muted-foreground" data-testid="output-valid">
          Output matches schema
        </p>
      )}
      {check.status === 'invalid' && (
        <div role="status" className="space-y-1 rounded-md border p-2 text-xs" data-testid="output-warning">
          <p className="font-medium">Warning: output does not match the declared outputSchema</p>
          <ul className="list-disc pl-4 break-words text-muted-foreground">
            {check.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ProgressBar({ progress }: { progress: ProgressView | null }) {
  const fraction = progress?.fraction ?? null
  const determinate = fraction !== null
  return (
    <div className="flex flex-col gap-1" data-testid="call-progress">
      <div
        role="progressbar"
        aria-label="Call progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction !== null ? Math.round(fraction * 100) : undefined}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full bg-primary', !determinate && 'w-1/3 animate-pulse')}
          style={fraction !== null ? { width: `${fraction * 100}%` } : undefined}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {progress ? progress.label : 'Waiting for the server…'}
        {progress?.message ? ` — ${progress.message}` : ''}
      </p>
    </div>
  )
}

const ToolsTab: ComponentType<TabProps> = ({ session, profileId }) => {
  const [list, setList] = useState<ListState>({ loading: true, tools: [], truncated: false, reason: null, error: null })
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [entries, setEntries] = useState<Map<string, Entry>>(() => new Map())
  const [timeoutText, setTimeoutText] = useState(String(DEFAULT_TIMEOUT_MS))
  const [call, setCall] = useState<CallState>({ status: 'idle' })
  const [pending, setPending] = useState<PendingCall | null>(null)
  const [dontAsk, setDontAsk] = useState(false)

  const mounted = useRef(false)
  const listSeq = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const skipConfirm = useRef<Set<string>>(new Set())

  const history = useMcpInspectorStore((s) => s.history)
  const saveHistory = useMcpInspectorStore((s) => s.prefs.saveHistory)
  const pushHistory = useMcpInspectorStore((s) => s.pushHistory)
  const clearHistory = useMcpInspectorStore((s) => s.clearHistory)

  // ── listing ────────────────────────────────────────────────────────────────

  const fetchTools = useCallback(async () => {
    const seq = ++listSeq.current
    const res = await collectPages<McpTool>(async (cursor) => {
      const r = await session.rawRequest('tools/list', cursor === undefined ? undefined : { cursor })
      if (!r.ok) {
        throw new Error(r.error.code === null ? r.error.message : `${r.error.message} (code ${r.error.code})`)
      }
      return parseToolsPage(r.result)
    })
    if (!mounted.current || seq !== listSeq.current) return
    setList({ loading: false, tools: res.items, truncated: res.truncated, reason: res.reason, error: res.error })
  }, [session])

  const refresh = useCallback(() => {
    setList((l) => ({ ...l, loading: true }))
    void fetchTools()
  }, [fetchTools])

  useEffect(() => {
    mounted.current = true
    void fetchTools()
    const off = session.onListChanged((kind) => {
      if (kind === 'tools') refresh()
    })
    return () => {
      mounted.current = false
      off()
      abortRef.current?.abort()
    }
  }, [session, fetchTools, refresh])

  const visible = useMemo(() => filterTools(list.tools, query), [list.tools, query])
  const selected = useMemo(() => list.tools.find((t) => t.name === selectedName) ?? null, [list.tools, selectedName])

  // ── per-tool editing state ─────────────────────────────────────────────────

  const entry: Entry | null = useMemo(() => {
    if (!selected) return null
    const stored = entries.get(selected.name)
    return stored && stored.schemaKey === schemaKeyOf(selected) ? stored : freshEntry(selected)
  }, [entries, selected])

  const updateEntry = useCallback((tool: McpTool, patch: (e: Entry) => Entry) => {
    setEntries((prev) => {
      const stored = prev.get(tool.name)
      const base = stored && stored.schemaKey === schemaKeyOf(tool) ? stored : freshEntry(tool)
      const next = new Map(prev)
      next.set(tool.name, patch(base))
      return next
    })
  }, [])

  const running = call.status === 'running'

  // ── calling ────────────────────────────────────────────────────────────────

  const runCall = useCallback(
    async (tool: McpTool, args: Record<string, unknown>) => {
      const controller = new AbortController()
      abortRef.current = controller
      const timeoutMs = clampTimeoutMs(timeoutText)
      setTimeoutText(String(timeoutMs))
      setCall({ status: 'running', toolName: tool.name, progress: null })
      const started = Date.now()
      let outcome: CallOutcome
      try {
        const raw = await session.client.request(
          { method: 'tools/call', params: { name: tool.name, arguments: args } as Record<string, unknown> },
          ANY_RESULT,
          {
            timeout: timeoutMs,
            signal: controller.signal,
            onprogress: (p) => {
              if (!mounted.current || abortRef.current !== controller) return
              setCall((c) => (c.status === 'running' ? { ...c, progress: progressView(p) } : c))
            },
          },
        )
        outcome = classifyCallResult(raw)
      } catch (e) {
        outcome = classifyCallError(e, { timeoutMs, aborted: controller.signal.aborted })
      }
      const durationMs = Math.max(0, Date.now() - started)
      if (abortRef.current === controller) abortRef.current = null
      pushHistory({
        kind: 'tool',
        name: tool.name,
        argsJson: JSON.stringify(args),
        ok: outcome.kind === 'success',
        durationMs,
        profileId,
      })
      if (mounted.current) setCall({ status: 'done', toolName: tool.name, outcome, durationMs, tool })
    },
    [session, timeoutText, pushHistory, profileId],
  )

  const startCall = useCallback(() => {
    if (!selected || !entry || running) return
    let args: Record<string, unknown>
    if (entry.draft.mode === 'form') {
      const r = toArguments(selected.inputSchema, entry.draft.formValue)
      if (!r.ok) {
        updateEntry(selected, (e) => ({ ...e, formErrors: r.errors, notice: null }))
        return
      }
      args = r.arguments
    } else {
      const r = parseArgsText(entry.draft.jsonText)
      if (!r.ok) return // the JSON editor already shows the parse error
      args = r.value
    }
    updateEntry(selected, (e) => ({ ...e, formErrors: [], switchErrors: [], notice: null }))
    if (isDestructive(selected) && !skipConfirm.current.has(selected.name)) {
      setDontAsk(false)
      setPending({ tool: selected, args })
      return
    }
    void runCall(selected, args)
  }, [selected, entry, running, updateEntry, runCall])

  const confirmPending = () => {
    if (!pending) return
    if (dontAsk) skipConfirm.current.add(pending.tool.name)
    const p = pending
    setPending(null)
    void runCall(p.tool, p.args)
  }

  const cancelCall = () => abortRef.current?.abort()

  // ── history ────────────────────────────────────────────────────────────────

  const toolEntries = useMemo(
    () => (selected ? toolHistory(history, profileId, selected.name) : []),
    [history, profileId, selected],
  )

  const loadFromHistory = (argsJson: string) => {
    if (!selected || !entry) return
    const r = loadHistoryArgs(selected.inputSchema, entry.draft, argsJson)
    updateEntry(selected, (e) => ({ ...e, draft: r.draft, formErrors: r.errors, switchErrors: [], notice: r.notice }))
  }

  // ── render ─────────────────────────────────────────────────────────────────

  const resultForSelected = call.status === 'done' && selected && call.toolName === selected.name ? call : null
  const runningHere = call.status === 'running' && selected !== null && call.toolName === selected.name

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside
        aria-label="Tools"
        className="flex max-h-72 min-h-0 flex-col gap-2 overflow-auto border-b p-3 md:max-h-none md:w-80 md:shrink-0 md:border-r md:border-b-0"
      >
        <div className="flex items-center gap-2">
          <Input
            type="search"
            aria-label="Search tools"
            placeholder="Search tools"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="button" variant="outline" size="icon" aria-label="Refresh" title="Refresh" disabled={list.loading} onClick={refresh}>
            <RefreshCw className={cn(list.loading && 'animate-spin')} />
          </Button>
        </div>

        {list.loading && list.tools.length === 0 && !list.error && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading tools…
          </p>
        )}
        {list.error && (
          <div role="alert" className="space-y-2 rounded-md border border-destructive/50 p-2 text-sm text-destructive">
            <p className="break-words">{`Could not list tools: ${list.error}`}</p>
            <Button type="button" variant="outline" size="xs" onClick={refresh}>
              Retry
            </Button>
          </div>
        )}
        {list.truncated && (
          <p role="status" className="rounded-md border p-2 text-xs text-muted-foreground" data-testid="truncated-notice">
            {truncationNotice(list.reason)}
          </p>
        )}
        {!list.loading && !list.error && list.tools.length === 0 && (
          <p className="text-sm text-muted-foreground">This server exposes no tools.</p>
        )}
        {list.tools.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground" data-testid="tool-count">
              {countLabel(visible.length, list.tools.length)}
            </p>
            {visible.length === 0 && <p className="text-sm text-muted-foreground">No tools match your search.</p>}
            <ul className="flex flex-col gap-1">
              {visible.map((t, i) => (
                <li key={`${i}:${t.name}`}>
                  <button
                    type="button"
                    aria-current={selected?.name === t.name ? 'true' : undefined}
                    onClick={() => setSelectedName(t.name)}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-md border p-2 text-left text-sm hover:bg-muted',
                      selected?.name === t.name && 'border-ring bg-muted',
                    )}
                  >
                    <span className="font-medium break-words">{toolLabel(t)}</span>
                    {t.description && (
                      <span className="line-clamp-2 text-xs break-words text-muted-foreground">{t.description}</span>
                    )}
                    <ToolBadges tool={t} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <section aria-label="Tool details" className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        {!selected || !entry ? (
          <p className="text-sm text-muted-foreground">Select a tool to see its arguments and call it.</p>
        ) : (
          <>
            <header className="flex flex-col gap-1">
              <h2 className="text-base font-semibold break-words">{toolLabel(selected)}</h2>
              {selected.title && <p className="font-mono text-xs break-all text-muted-foreground">{selected.name}</p>}
              <ToolBadges tool={selected} />
              {selected.description && (
                <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">{selected.description}</p>
              )}
              <div className="flex flex-col gap-1 text-xs">
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Input schema</summary>
                  <JsonView value={selected.inputSchema} className="mt-1" />
                </details>
                {selected.outputSchema && (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">Output schema</summary>
                    <JsonView value={selected.outputSchema} className="mt-1" />
                  </details>
                )}
              </div>
            </header>

            <ToolForm
              tool={selected}
              draft={entry.draft}
              disabled={running}
              formErrors={entry.formErrors}
              switchErrors={entry.switchErrors}
              notice={entry.notice}
              onDraftChange={(draft) => updateEntry(selected, (e) => ({ ...e, draft, formErrors: [], switchErrors: [] }))}
              onModeChange={(to) => {
                const r = switchMode(selected.inputSchema, entry.draft, to)
                updateEntry(selected, (e) => ({
                  ...e,
                  draft: r.draft,
                  formErrors: [],
                  switchErrors: r.errors,
                  notice: r.notice,
                }))
              }}
            />

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="mcp-tool-timeout">Timeout (ms)</Label>
                <Input
                  id="mcp-tool-timeout"
                  type="number"
                  inputMode="numeric"
                  className="w-32"
                  min={1000}
                  step={1000}
                  value={timeoutText}
                  disabled={running}
                  onChange={(e) => setTimeoutText(e.target.value)}
                  onBlur={() => setTimeoutText(String(clampTimeoutMs(timeoutText)))}
                />
              </div>
              <Button type="button" disabled={running} onClick={startCall}>
                {running ? 'Calling…' : 'Call tool'}
              </Button>
              {running && (
                <Button type="button" variant="outline" onClick={cancelCall}>
                  Cancel
                </Button>
              )}
              {isDestructive(selected) && (
                <p className="text-xs text-muted-foreground">This tool is marked destructive; you will be asked to confirm.</p>
              )}
            </div>

            {runningHere && <ProgressBar progress={call.progress} />}
            {resultForSelected && (
              <ResultPanel call={resultForSelected} check={checkOutputSchema(resultForSelected.tool, resultForSelected.outcome)} />
            )}

            <section aria-label="History" className="flex flex-col gap-2 border-t pt-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">History</h3>
                {saveHistory && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="ml-auto"
                    title="Removes all saved history (tools, prompts, resources, raw) for this profile"
                    onClick={() => clearHistory(profileId)}
                  >
                    Clear
                  </Button>
                )}
              </div>
              {!saveHistory ? (
                <p className="text-xs text-muted-foreground">History is off. Calls are not being saved.</p>
              ) : toolEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground">No calls to this tool yet.</p>
              ) : (
                <ul className="flex flex-col gap-1" data-testid="history-list">
                  {toolEntries.map((h) => (
                    <li key={h.id} className="flex items-center gap-2 rounded-md border p-2 text-xs">
                      <span className="shrink-0 text-muted-foreground">{new Date(h.ts).toLocaleTimeString()}</span>
                      <span className="shrink-0 font-medium">{h.ok ? 'ok' : 'failed'}</span>
                      <span className="shrink-0 text-muted-foreground">{`${h.durationMs} ms`}</span>
                      <span className="min-w-0 flex-1 truncate font-mono" title={h.argsJson}>
                        {argsPreview(h.argsJson)}
                      </span>
                      <Button type="button" variant="outline" size="xs" disabled={running} onClick={() => loadFromHistory(h.argsJson)}>
                        Load
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </section>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Call a destructive tool?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? `The server marks "${toolLabel(pending.tool)}" as destructive: it may change or delete data. Nothing is sent until you confirm.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2">
            <Checkbox id="mcp-tool-dont-ask" checked={dontAsk} onCheckedChange={(c) => setDontAsk(c === true)} />
            <Label htmlFor="mcp-tool-dont-ask">Don&apos;t ask again this session for this tool</Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPending}>Call tool</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ToolBadges({ tool }: { tool: McpTool }) {
  const badges = annotationBadges(tool)
  if (badges.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1" aria-label="Annotations">
      {badges.map((b) => (
        <Badge key={b.key} variant={b.key === 'destructiveHint' && b.value ? 'destructive' : 'outline'}>
          {b.label}
        </Badge>
      ))}
    </span>
  )
}

export default ToolsTab
