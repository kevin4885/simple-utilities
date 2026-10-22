import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  logTone,
  LOGGING_LEVELS,
  needsReconnect,
  parseLogParams,
  rootsSignature,
  type LoggingLevel,
  type LogTone,
} from '../../client-features/logic'
import { useClientPending } from '../../client-features/pendingStore'
import { useClientSettings } from '../../client-features/settingsStore'
import { errorMessage } from '../../connection/logic'
import { JsonView } from '../../shell/JsonView'
import type { TabProps } from '../../shell/logic'

const TONE_CLASS: Record<LogTone, string> = {
  quiet: 'text-muted-foreground',
  normal: 'text-foreground',
  warn: 'font-semibold text-foreground',
  error: 'font-semibold text-destructive',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border p-3" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function ReconnectNotice() {
  return (
    <p role="status" className="text-xs font-medium text-destructive" data-testid="reconnect-notice">
      Reconnect to apply
    </p>
  )
}

function FeatureToggle({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange(v: boolean): void
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChange(c === true)} className="mt-0.5" />
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function RootsEditor() {
  const roots = useClientSettings((s) => s.roots)
  const setRootsEnabled = useClientSettings((s) => s.setRootsEnabled)
  const addRoot = useClientSettings((s) => s.addRoot)
  const removeRoot = useClientSettings((s) => s.removeRoot)
  const [uri, setUri] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    const err = addRoot(uri, name)
    setError(err)
    if (err === null) {
      setUri('')
      setName('')
    }
  }

  return (
    <div className="space-y-2">
      <FeatureToggle
        id="cf-roots"
        label="Roots"
        description="Tell the server which locations (URIs) it may work with. Answered automatically, without asking."
        checked={roots.enabled}
        onChange={setRootsEnabled}
      />
      <ul className="space-y-1" aria-label="Roots">
        {roots.items.length === 0 && <li className="text-xs text-muted-foreground">No roots configured.</li>}
        {roots.items.map((r, i) => (
          <li key={r.uri} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 font-mono text-xs break-all">
              {r.uri}
              {r.name !== null && <span className="ml-2 font-sans text-muted-foreground">({r.name})</span>}
            </span>
            <Button type="button" variant="outline" size="xs" aria-label={`Remove root ${r.uri}`} onClick={() => removeRoot(i)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="cf-root-uri">Root URI</Label>
          <Input
            id="cf-root-uri"
            value={uri}
            placeholder="file:///home/me/project"
            aria-invalid={error !== null}
            aria-describedby={error !== null ? 'cf-root-error' : undefined}
            onChange={(e) => setUri(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </div>
        <div className="w-40 space-y-1">
          <Label htmlFor="cf-root-name">Name (optional)</Label>
          <Input id="cf-root-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Add root
        </Button>
      </div>
      {error !== null && (
        <p id="cf-root-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function SettingsSection() {
  const settings = useClientSettings()
  const applied = useClientPending((s) => s.applied)
  const reconnect = needsReconnect(applied?.snapshot ?? null, settings)

  return (
    <Section title="Client features">
      <p className="text-xs text-muted-foreground">
        What this inspector offers to the server. Which features are declared is fixed when you connect.
      </p>
      <RootsEditor />
      <FeatureToggle
        id="cf-sampling"
        label="Sampling"
        description="Let the server ask for a model reply. Each request opens a dialog and you type the answer by hand."
        checked={settings.sampling.enabled}
        onChange={settings.setSamplingEnabled}
      />
      <FeatureToggle
        id="cf-elicitation"
        label="Elicitation"
        description="Let the server ask you for information (form) or to complete something at a link (URL mode)."
        checked={settings.elicitation.enabled}
        onChange={settings.setElicitationEnabled}
      />
      {reconnect && <ReconnectNotice />}
    </Section>
  )
}

function RequestsSection() {
  const pending = useClientPending((s) => s.pending)
  const recent = useClientPending((s) => s.recent)

  return (
    <Section title="Server requests">
      <div className="space-y-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">Pending ({pending.length})</h3>
        {pending.length === 0 ? (
          <p className="text-xs text-muted-foreground">No requests are waiting.</p>
        ) : (
          <ul className="space-y-1" aria-label="Pending requests">
            {pending.map((p) => (
              <li key={p.id} className="text-sm break-words" data-testid="pending-item">
                <span className="font-medium">{p.kind}</span>
                <span className="ml-2 text-xs text-muted-foreground">{new Date(p.receivedAt).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">Recently answered (last 20)</h3>
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing answered yet.</p>
        ) : (
          <ul className="space-y-1" aria-label="Recent requests">
            {[...recent].reverse().map((r) => (
              <li key={r.id} className="text-sm break-words" data-testid="recent-item">
                <span className="font-medium">{r.kind}</span> — <span>{r.outcome}</span>
                <span className="ml-2 text-xs text-muted-foreground">{new Date(r.at).toLocaleTimeString()}</span>
                {r.summary !== '' && <p className="text-xs text-muted-foreground">{r.summary}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

// Server logs belong to one session; a numeric id avoids the global store holding on to a closed session.
const sessionLogIds = new WeakMap<object, number>()
let nextSessionLogId = 1
function sessionLogId(session: object): number {
  let id = sessionLogIds.get(session)
  if (id === undefined) {
    id = nextSessionLogId++
    sessionLogIds.set(session, id)
  }
  return id
}

function rejectedText(e: unknown): string {
  return `The server rejected the log level: ${errorMessage(e)}`
}

function LoggingSection({ session, info }: Pick<TabProps, 'session' | 'info'>) {
  const level = useClientSettings((s) => s.loggingLevel)
  const setLevel = useClientSettings((s) => s.setLoggingLevel)
  const logs = useClientPending((s) => s.serverLogs)
  const clearLogs = useClientPending((s) => s.clearServerLogs)
  const [status, setStatus] = useState<string | null>(null)

  const supported = info.capabilities.logging !== undefined

  // Observe inbound `notifications/message`. Logs belong to one session: a new connection starts a fresh list.
  useEffect(() => {
    const store = useClientPending.getState()
    store.claimLogs(sessionLogId(session))
    return session.onNotification('notifications/message', (params) => {
      const p = parseLogParams(params)
      useClientPending.getState().addServerLog({ ts: Date.now(), level: p.level, logger: p.logger, data: p.data })
    })
  }, [session])

  // session.client throws synchronously when the session is no longer connected, hence the try around both.
  const send = async (next: LoggingLevel) => {
    try {
      await session.client.setLoggingLevel(next)
    } catch (e) {
      setStatus(rejectedText(e))
    }
  }
  const change = (next: LoggingLevel) => {
    setLevel(next)
    setStatus(null)
    void send(next)
  }

  // The select shows the saved level, so tell a freshly connected server about it once.
  useEffect(() => {
    if (!supported) return
    // Deferred a microtask so a synchronous throw of `session.client` (not connected) is caught like a rejection.
    Promise.resolve()
      .then(() => session.client.setLoggingLevel(useClientSettings.getState().loggingLevel))
      .catch((e: unknown) => setStatus(rejectedText(e)))
  }, [session, supported])

  return (
    <Section title="Server log messages">
      <div className="flex flex-wrap items-center gap-2">
        <Label id="cf-level-label">Log level</Label>
        <Select value={level} onValueChange={(v) => change(v as LoggingLevel)} disabled={!supported}>
          <SelectTrigger aria-labelledby="cf-level-label" size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOGGING_LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="xs" onClick={clearLogs} disabled={logs.length === 0}>
          Clear
        </Button>
        {!supported && (
          <span className="text-xs text-muted-foreground" data-testid="logging-disabled-reason">
            The server does not advertise the logging capability.
          </span>
        )}
      </div>
      {status !== null && (
        <p role="alert" className="text-xs text-destructive">
          {status}
        </p>
      )}
      {logs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No log messages received. Messages are collected while this tab is open (the Log drawer shows all traffic).
        </p>
      ) : (
        <ul className="space-y-1" aria-label="Server log messages">
          {logs.map((l) => (
            <li key={l.id} className="space-y-0.5 rounded-md border p-2 text-xs" data-testid="server-log">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-muted-foreground">{new Date(l.ts).toLocaleTimeString()}</span>
                <span className={cn('uppercase', TONE_CLASS[logTone(l.level)])} data-testid="server-log-level">
                  {l.level}
                </span>
                {l.logger !== null && <span className="font-mono text-muted-foreground">{l.logger}</span>}
              </div>
              <JsonView value={l.data} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** Announces edits of the roots list when the connection declared `roots.listChanged`. */
function useRootsListChanged(session: TabProps['session']) {
  const items = useClientSettings((s) => s.roots.items)
  const listChanged = useClientPending((s) => s.applied?.snapshot.rootsListChanged === true)
  const signature = rootsSignature(items)
  const last = useRef(signature)

  useEffect(() => {
    if (last.current === signature) return
    last.current = signature
    if (listChanged) void session.rawNotification('notifications/roots/list_changed')
  }, [signature, listChanged, session])
}

export default function ClientTab({ session, info }: TabProps) {
  useRootsListChanged(session)
  return (
    <div className="space-y-3 p-3">
      <SettingsSection />
      <RequestsSection />
      <LoggingSection session={session} info={info} />
    </div>
  )
}
