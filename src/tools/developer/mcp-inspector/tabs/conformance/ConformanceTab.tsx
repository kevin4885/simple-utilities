import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Info, Loader2, MinusCircle, XCircle, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { CALL_SMOKE_LABEL, CHECKS, defaultSelection, groupChecks } from '../../conformance/checks'
import { buildMarkdown, buildReport, countResults } from '../../conformance/report'
import { runChecks } from '../../conformance/runner'
import { CHECK_STATUSES, type Check, type CheckResult, type CheckStatus } from '../../conformance/types'
import { secretFragments } from '../../connection/logic'
import { JsonView } from '../../shell/JsonView'
import { useLogStore } from '../../shell/logStore'
import type { TabProps } from '../../shell/logic'
import { copyText, downloadBlob } from '../../shell/viewerIo'

const CALL_SMOKE_ID = 'tools.call-smoke'

// Every status has an icon AND a word: colour is never the only signal.
const STATUS_VIEW: Record<CheckStatus, { label: string; Icon: LucideIcon; className: string }> = {
  pass: { label: 'Pass', Icon: CheckCircle2, className: 'text-chart-5' },
  fail: { label: 'Fail', Icon: XCircle, className: 'text-destructive' },
  warn: { label: 'Warn', Icon: AlertTriangle, className: 'text-chart-4' },
  skip: { label: 'Skip', Icon: MinusCircle, className: 'text-muted-foreground' },
  info: { label: 'Info', Icon: Info, className: 'text-chart-2' },
}

function ResultRow({ result }: { result: CheckResult }) {
  const [open, setOpen] = useState(false)
  const view = STATUS_VIEW[result.status]
  const hasDetail = result.detail !== undefined
  return (
    <div className="mt-1 text-sm" data-testid={`result-${result.id}`}>
      <div className="flex flex-wrap items-start gap-2">
        <span className={cn('inline-flex shrink-0 items-center gap-1 font-medium', view.className)}>
          <view.Icon className="size-4" aria-hidden="true" />
          {view.label}
        </span>
        <span className="min-w-0 flex-1 break-words">{result.message}</span>
        {hasDetail && (
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} details for ${result.id}`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            Details
          </Button>
        )}
      </div>
      {hasDetail && open && <JsonView value={result.detail} className="mt-1 max-h-64 overflow-auto rounded-md border bg-muted/40 p-2 text-xs" />}
    </div>
  )
}

const ConformanceTab: ComponentType<TabProps> = ({ session, info, sessionOptions }) => {
  const [selected, setSelected] = useState<Set<string>>(() => defaultSelection())
  const [results, setResults] = useState<Map<string, CheckResult>>(new Map())
  const [running, setRunning] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const groups = useMemo(() => groupChecks(), [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const run = useCallback(
    async (ids: string[]) => {
      if (abortRef.current || ids.length === 0) return
      const checks = CHECKS.filter((c) => ids.includes(c.id))
      const ac = new AbortController()
      abortRef.current = ac
      setRunning(true)
      setNotice(null)
      setPending(new Set(checks.map((c) => c.id)))
      setResults((prev) => {
        const next = new Map(prev)
        for (const c of checks) next.delete(c.id)
        return next
      })
      try {
        await runChecks(
          checks,
          { session, info, sessionOptions, onLog: (e) => useLogStore.getState().append(e) },
          {
            signal: ac.signal,
            onStart: (id) => {
              if (mountedRef.current) setCurrentId(id)
            },
            onResult: (r) => {
              if (!mountedRef.current) return
              setResults((prev) => new Map(prev).set(r.id, r))
              setPending((prev) => {
                const next = new Set(prev)
                next.delete(r.id)
                return next
              })
            },
          },
        )
      } finally {
        abortRef.current = null
        if (mountedRef.current) {
          setRunning(false)
          setCurrentId(null)
          setPending(new Set())
        }
      }
    },
    [session, info, sessionOptions],
  )

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const ordered = useMemo(() => CHECKS.filter((c) => results.has(c.id)).map((c) => results.get(c.id) as CheckResult), [results])
  const counts = useMemo(() => countResults(ordered), [ordered])

  const reportFor = useCallback(() => {
    // Header values and the session id must never reach an export, not even inside a check message.
    const secrets = [...secretFragments(sessionOptions.config.headers, true), ...(info.sessionId ? [info.sessionId] : [])]
    return buildReport(ordered, info, Date.now(), secrets)
  }, [ordered, info, sessionOptions])

  const downloadJson = () => {
    downloadBlob('mcp-conformance-report.json', JSON.stringify(reportFor(), null, 2), 'application/json')
    setNotice('Report downloaded')
  }
  const copyMarkdown = async () => {
    const ok = await copyText(buildMarkdown(reportFor()))
    setNotice(ok ? 'Markdown copied' : 'Copy failed: clipboard unavailable')
  }

  const rowState = (c: Check): 'running' | 'queued' | null => {
    if (!pending.has(c.id)) return null
    return currentId === c.id ? 'running' : 'queued'
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={running || selected.size === 0} onClick={() => void run(CHECKS.filter((c) => selected.has(c.id)).map((c) => c.id))}>
          Run selected
        </Button>
        {running && (
          <Button size="sm" variant="destructive" onClick={() => abortRef.current?.abort()}>
            Stop
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={ordered.length === 0} onClick={downloadJson}>
          Download JSON
        </Button>
        <Button size="sm" variant="outline" disabled={ordered.length === 0} onClick={() => void copyMarkdown()}>
          Copy Markdown
        </Button>
        {running && (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Running…
          </span>
        )}
        {notice && !running && (
          <span className="text-sm text-muted-foreground" role="status">
            {notice}
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground" aria-label="Summary">
        {CHECK_STATUSES.map((s) => `${STATUS_VIEW[s].label}: ${counts[s]}`).join(' · ')}
      </p>

      {groups.map(({ group, checks }) => (
        <section key={group} aria-label={group} className="rounded-md border">
          <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <h3 className="text-sm font-semibold">{group}</h3>
            <Button
              size="xs"
              variant="outline"
              disabled={running}
              aria-label={`Run group ${group}`}
              onClick={() => void run(checks.map((c) => c.id))}
            >
              Run group
            </Button>
          </header>
          <ul className="divide-y">
            {checks.map((c) => {
              const result = results.get(c.id)
              const state = rowState(c)
              return (
                <li key={c.id} className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={`check-${c.id}`}
                      className="mt-0.5"
                      checked={selected.has(c.id)}
                      disabled={running}
                      onCheckedChange={(v) => toggle(c.id, v === true)}
                    />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`check-${c.id}`} className="block cursor-pointer text-sm font-medium">
                        {c.title}
                        {c.id === CALL_SMOKE_ID && <span className="font-normal text-muted-foreground"> — {CALL_SMOKE_LABEL}</span>}
                      </label>
                      <p className="break-words text-xs text-muted-foreground">
                        <code>{c.id}</code> · {c.spec}
                      </p>
                      {state && (
                        <p className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground">
                          <Loader2 className={cn('size-4', state === 'running' && 'animate-spin')} aria-hidden="true" />
                          {state === 'running' ? 'Running' : 'Queued'}
                        </p>
                      )}
                      {result && <ResultRow result={result} />}
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={running}
                      aria-label={`Re-run ${c.id}`}
                      onClick={() => void run([c.id])}
                    >
                      {result ? 'Re-run' : 'Run'}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default ConformanceTab
