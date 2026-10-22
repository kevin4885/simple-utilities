import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from 'react'
import CodeEditor from '@/components/editor/CodeEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { JsonView } from '../../shell/JsonView'
import type { TabProps } from '../../shell/logic'
import { useUiStore } from '../../shell/uiStore'
import { useMcpInspectorStore } from '../../store'
import {
  DEFAULT_TIMEOUT_MS,
  historyArgs,
  isBlockedMethod,
  KNOWN_METHODS,
  parseRawParams,
  parseTimeoutMs,
} from './logic'

type Mode = 'request' | 'notification'

type Outcome =
  | { kind: 'result'; result: unknown; durationMs: number }
  | { kind: 'protocol-error'; error: { code: number; message: string; data?: unknown }; durationMs: number }
  | { kind: 'local-failure'; message: string; durationMs: number }
  | { kind: 'cancelled'; durationMs: number }
  | { kind: 'notification-sent' }
  | { kind: 'notification-failed'; message: string }

const RECENT_LIMIT = 10

function modeFor(method: string): Mode {
  return method.trim().startsWith('notifications/') ? 'notification' : 'request'
}

const RawTab: ComponentType<TabProps> = ({ session, profileId }) => {
  const [method, setMethod] = useState('')
  const [paramsText, setParamsText] = useState('')
  const [mode, setMode] = useState<Mode>('request')
  const [timeoutText, setTimeoutText] = useState(String(DEFAULT_TIMEOUT_MS))
  const [inFlight, setInFlight] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const methodListId = useId()
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  const loadedNonce = useRef(0)

  const rawDraft = useUiStore((s) => s.rawDraft)
  const setRawDraft = useUiStore((s) => s.setRawDraft)
  const history = useMcpInspectorStore((s) => s.history)
  const pushHistory = useMcpInspectorStore((s) => s.pushHistory)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
    }
  }, [])

  // Draft handoff (log drawer "Edit & resend"): load each nonce once, then consume it so a
  // remount of this tab does not overwrite later edits.
  useEffect(() => {
    if (!rawDraft || rawDraft.nonce <= loadedNonce.current) return
    loadedNonce.current = rawDraft.nonce
    setMethod(rawDraft.method)
    setParamsText(rawDraft.paramsText)
    setMode(modeFor(rawDraft.method))
    setOutcome(null)
    setRawDraft(null)
  }, [rawDraft, setRawDraft])

  const recent = useMemo(
    () => history.filter((h) => h.profileId === profileId && h.kind === 'raw').slice(-RECENT_LIMIT).reverse(),
    [history, profileId],
  )

  const blocked = isBlockedMethod(method)
  const params = parseRawParams(paramsText)
  const timeout = parseTimeoutMs(timeoutText)
  const paramsError = params.ok ? null : params.error
  const timeoutError = mode === 'request' && !timeout.ok ? timeout.error : null
  const methodError = method.trim() === '' ? null : blocked
  const canSend = !inFlight && blocked === null && params.ok && (mode === 'notification' || timeout.ok)

  async function send() {
    if (!canSend || !params.ok) return
    const name = method.trim()
    const args = historyArgs(paramsText)
    setOutcome(null)
    const record = (ok: boolean, durationMs: number) =>
      pushHistory({ profileId, kind: 'raw', name, argsJson: args, ok, durationMs })

    if (mode === 'notification') {
      setInFlight(true)
      const started = Date.now()
      const r = await session.rawNotification(name, params.params)
      const durationMs = Math.max(0, Date.now() - started)
      record(r.ok, durationMs)
      if (!mountedRef.current) return
      setInFlight(false)
      setOutcome(r.ok ? { kind: 'notification-sent' } : { kind: 'notification-failed', message: r.message })
      return
    }

    if (!timeout.ok) return
    const controller = new AbortController()
    controllerRef.current = controller
    setInFlight(true)
    const r = await session.rawRequest(name, params.params, { timeoutMs: timeout.ms, signal: controller.signal })
    const cancelled = controller.signal.aborted
    if (controllerRef.current === controller) controllerRef.current = null
    record(r.ok, r.durationMs)
    if (!mountedRef.current) return
    setInFlight(false)
    if (cancelled) setOutcome({ kind: 'cancelled', durationMs: r.durationMs })
    else if (r.ok) setOutcome({ kind: 'result', result: r.result, durationMs: r.durationMs })
    else if (r.error.code === null) setOutcome({ kind: 'local-failure', message: r.error.message, durationMs: r.durationMs })
    else setOutcome({ kind: 'protocol-error', error: { ...r.error, code: r.error.code }, durationMs: r.durationMs })
  }

  function loadRecent(name: string, argsJson: string) {
    setMethod(name)
    setParamsText(argsJson)
    setMode(modeFor(name))
    setOutcome(null)
  }

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${methodListId}-method`}>Method</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id={`${methodListId}-method`}
            className="min-w-48 flex-1 font-mono"
            placeholder="tools/list"
            list={methodListId}
            value={method}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={methodError !== null}
            onChange={(e) => setMethod(e.target.value)}
          />
          <datalist id={methodListId}>
            {KNOWN_METHODS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <fieldset className="flex items-center gap-3 text-sm">
            <legend className="sr-only">Message type</legend>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`${methodListId}-mode`}
                checked={mode === 'request'}
                onChange={() => setMode('request')}
              />
              Request
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`${methodListId}-mode`}
                checked={mode === 'notification'}
                onChange={() => setMode('notification')}
              />
              Notification
            </label>
          </fieldset>
        </div>
        {methodError && (
          <p role="alert" className="text-xs text-destructive">
            {methodError}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Params (JSON object or array, optional)</Label>
        <div className="h-44 overflow-hidden rounded-md border" data-testid="raw-params-editor">
          <CodeEditor value={paramsText} onChange={setParamsText} language="json" height="100%" placeholder='{"name": "value"}' />
        </div>
        {paramsError && (
          <p role="alert" className="text-xs text-destructive">
            {paramsError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {mode === 'request' && (
          <div className="space-y-1.5">
            <Label htmlFor={`${methodListId}-timeout`}>Timeout (ms)</Label>
            <Input
              id={`${methodListId}-timeout`}
              className="w-32"
              type="number"
              min={1000}
              step={1000}
              value={timeoutText}
              aria-invalid={timeoutError !== null}
              onChange={(e) => setTimeoutText(e.target.value)}
            />
          </div>
        )}
        <Button type="button" disabled={!canSend} onClick={() => void send()}>
          {inFlight ? 'Sending…' : mode === 'request' ? 'Send request' : 'Send notification'}
        </Button>
        {inFlight && mode === 'request' && (
          <Button type="button" variant="outline" onClick={() => controllerRef.current?.abort()}>
            Cancel
          </Button>
        )}
      </div>
      {timeoutError && (
        <p role="alert" className="text-xs text-destructive">
          {timeoutError}
        </p>
      )}

      {outcome && <OutcomeView outcome={outcome} />}

      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold">Recent</h3>
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">No raw requests sent for this profile yet.</p>
        ) : (
          <ul className="space-y-1">
            {recent.map((h) => (
              <li key={h.id}>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-auto w-full justify-start gap-2 py-1 font-mono"
                  title={h.argsJson}
                  onClick={() => loadRecent(h.name, h.argsJson)}
                >
                  <span className="truncate">{h.name}</span>
                  <span className={h.ok ? 'text-muted-foreground' : 'text-destructive'}>{h.ok ? 'ok' : 'failed'}</span>
                  <span className="ml-auto text-muted-foreground">{h.durationMs} ms</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function OutcomeView({ outcome }: { outcome: Outcome }) {
  switch (outcome.kind) {
    case 'result':
      return (
        <section className="space-y-1.5" aria-label="Response">
          <h3 className="text-sm font-semibold">
            Result <span className="font-normal text-muted-foreground">{outcome.durationMs} ms</span>
          </h3>
          <JsonView value={outcome.result} />
        </section>
      )
    case 'protocol-error': {
      const { code, message, data } = outcome.error
      return (
        <section className="space-y-1.5" aria-label="Response">
          <h3 className="text-sm font-semibold text-destructive">
            Protocol error <span className="font-normal text-muted-foreground">{outcome.durationMs} ms</span>
          </h3>
          <JsonView value={data === undefined ? { code, message } : { code, message, data }} />
        </section>
      )
    }
    case 'local-failure':
      return (
        <section className="space-y-1.5" aria-label="Response">
          <h3 className="text-sm font-semibold text-destructive">
            Local failure <span className="font-normal text-muted-foreground">{outcome.durationMs} ms</span>
          </h3>
          <p className="text-sm break-words">{outcome.message}</p>
        </section>
      )
    case 'cancelled':
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Cancelled
        </p>
      )
    case 'notification-sent':
      return (
        <p role="status" className="text-sm">
          Notification sent
        </p>
      )
    case 'notification-failed':
      return (
        <section className="space-y-1.5" aria-label="Response">
          <h3 className="text-sm font-semibold text-destructive">Local failure</h3>
          <p className="text-sm break-words">{outcome.message}</p>
        </section>
      )
  }
}

export default RawTab
