import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import type { LogEntry } from '../connection/types'
import { JsonView } from './JsonView'
import { useLogStore } from './logStore'
import { useUiStore } from './uiStore'
import { copyText } from './viewerIo'

type Kind = LogEntry['kind']
const KINDS: Kind[] = ['rpc', 'http', 'event']

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function formatDuration(ms: number | null): string | null {
  return ms === null ? null : `${Math.round(ms)} ms`
}

/** Short label for the row: method for rpc, `HTTP <method> <status>` for http, level for events. */
export function entryLabel(e: LogEntry): string {
  switch (e.kind) {
    case 'rpc':
      return e.method ?? (isRec(e.message) && 'error' in e.message ? 'error response' : 'response')
    case 'http':
      return `HTTP ${e.method} ${e.status ?? 'failed'}`
    case 'event':
      return e.level
  }
}

/** Secondary text shown after the label (url for http, text for events, id for rpc). */
function entryDetail(e: LogEntry): string {
  switch (e.kind) {
    case 'rpc':
      return e.rpcId === null ? '' : `#${String(e.rpcId)}`
    case 'http':
      return e.url
    case 'event':
      return e.text
  }
}

export function isErrorEntry(e: LogEntry): boolean {
  switch (e.kind) {
    case 'rpc':
      return e.direction === 'in' && isRec(e.message) && isRec(e.message.error)
    case 'http':
      return (e.status !== null && e.status >= 400) || e.error !== null
    case 'event':
      return e.level === 'error'
  }
}

export function matchesFilter(e: LogEntry, needle: string): boolean {
  if (needle === '') return true
  const hay =
    e.kind === 'rpc'
      ? [e.method ?? '']
      : e.kind === 'http'
        ? [e.method, e.url, String(e.status ?? '')]
        : [e.text]
  return hay.some((s) => s.toLowerCase().includes(needle))
}

/** `{method, paramsText}` for an outgoing request entry that may be re-sent, else null. */
export function resendDraft(e: LogEntry): { method: string; paramsText: string } | null {
  if (e.kind !== 'rpc' || e.direction !== 'out' || e.method === null || e.rpcId === null) return null
  const params = isRec(e.message) ? e.message.params : undefined
  return { method: e.method, paramsText: params === undefined ? '' : (JSON.stringify(params, null, 2) ?? '') }
}

function expandedValue(e: LogEntry): unknown {
  switch (e.kind) {
    case 'rpc':
      return e.message
    case 'http':
      return {
        method: e.method,
        url: e.url,
        status: e.status,
        requestHeaders: e.requestHeaders,
        responseHeaders: e.responseHeaders,
        durationMs: e.durationMs,
        error: e.error,
      }
    case 'event':
      return e
  }
}

function LogRow({ entry, expanded, onToggle }: { entry: LogEntry; expanded: boolean; onToggle: () => void }) {
  const setRawDraft = useUiStore((s) => s.setRawDraft)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const draft = resendDraft(entry)
  const duration = entry.kind === 'event' ? null : formatDuration(entry.durationMs)
  const error = isErrorEntry(entry)
  const direction = entry.kind === 'rpc' ? (entry.direction === 'out' ? '->' : '<-') : null
  const detail = entryDetail(entry)

  return (
    <li className="border-b last:border-b-0" data-slot="log-row" data-kind={entry.kind} data-error={error || undefined}>
      <div className="flex items-start gap-1">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className={cn(
            'flex min-w-0 flex-1 items-baseline gap-2 px-2 py-1 text-left font-mono text-xs hover:bg-accent/50',
            error && 'text-destructive',
          )}
        >
          <span className="shrink-0 text-muted-foreground">{new Date(entry.ts).toLocaleTimeString()}</span>
          <span className="shrink-0 uppercase">{entry.kind}</span>
          {direction && (
            <span className="shrink-0" aria-label={entry.kind === 'rpc' && entry.direction === 'out' ? 'sent' : 'received'}>
              {direction}
            </span>
          )}
          <span className="shrink-0 font-semibold">{entryLabel(entry)}</span>
          {detail && <span className="min-w-0 truncate">{detail}</span>}
          {duration && <span className="ml-auto shrink-0">{duration}</span>}
        </button>
        {draft && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="mt-0.5 mr-1 shrink-0"
            onClick={() => {
              setRawDraft(draft)
              setActiveTab('raw')
            }}
          >
            Edit &amp; resend
          </Button>
        )}
      </div>
      {expanded && (
        <div className="px-2 pb-2">
          <JsonView value={expandedValue(entry)} />
        </div>
      )}
    </li>
  )
}

export function LogDrawer({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const entries = useLogStore((s) => s.entries)
  const clear = useLogStore((s) => s.clear)
  const [filter, setFilter] = useState('')
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ rpc: true, http: true, event: true })
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())

  const needle = filter.trim().toLowerCase()
  const rows = useMemo(
    () =>
      [...entries]
        .sort((a, b) => a.id - b.id)
        .filter((e) => kinds[e.kind] && matchesFilter(e, needle)),
    [entries, kinds, needle],
  )

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <section className="flex shrink-0 flex-col border-t bg-background" aria-label="Message log" data-open={open}>
      <div className="flex flex-wrap items-center gap-2 px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          Log ({entries.length})
        </Button>
        {open && (
          <>
            <Input
              aria-label="Filter log"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 max-w-52 text-xs md:text-xs"
            />
            {KINDS.map((k) => (
              <Toggle
                key={k}
                size="sm"
                variant="outline"
                aria-label={`Show ${k}`}
                pressed={kinds[k]}
                onPressedChange={(p) => setKinds((prev) => ({ ...prev, [k]: p }))}
                className="h-7 min-w-0 px-2 text-xs"
              >
                {k}
              </Toggle>
            ))}
            <div className="ml-auto flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={entries.length === 0}
                onClick={() => void copyText(JSON.stringify(entries, null, 2))}
              >
                Copy all
              </Button>
              <Button type="button" variant="outline" size="xs" disabled={entries.length === 0} onClick={clear}>
                Clear
              </Button>
            </div>
          </>
        )}
      </div>
      {open && (
        <div className="h-64 overflow-auto border-t">
          {entries.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No log entries yet. Connect to a server to see traffic.</p>
          ) : rows.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No entries match the current filters.</p>
          ) : (
            <ul>
              {rows.map((e) => (
                <LogRow key={e.id} entry={e} expanded={expanded.has(e.id)} onToggle={() => toggleExpanded(e.id)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
