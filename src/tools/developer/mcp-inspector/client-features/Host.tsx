import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { initialFormValue, SchemaForm, supportsForm, toArguments, type FieldError, type FormValue, type JsonSchema } from '../schema-form'
import { ContentView } from '../shell/ContentView'
import { JsonView } from '../shell/JsonView'
import {
  analyzeUrl,
  buildElicitResult,
  buildSamplingResult,
  DEFAULT_SAMPLING_MODEL,
  DEFAULT_STOP_REASON,
  parseElicitationParams,
  parseRawContent,
  parseSamplingParams,
  validateElicitContent,
  type ElicitAction,
} from './logic'
import { useClientPending, type PendingRequest } from './pendingStore'
import { samplingRejection } from './register'

// Everything the server sends (prompts, messages, schema text, URLs) is untrusted: it is rendered as text only,
// URLs are never fetched or opened except by an explicit click on "Open link" (http/https only).

function Heading({ children }: { children: string }) {
  return <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>
}

function SamplingBody({ request }: { request: PendingRequest }) {
  const view = parseSamplingParams(request.params)
  const [text, setText] = useState('')
  const [model, setModel] = useState(DEFAULT_SAMPLING_MODEL)
  const [stopReason, setStopReason] = useState(DEFAULT_STOP_REASON)
  const store = useClientPending.getState()

  return (
    <>
      <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
        <section className="space-y-1" aria-label="System prompt">
          <Heading>System prompt</Heading>
          {view.systemPrompt ? (
            <p className="rounded-md border bg-muted/30 p-2 text-sm break-words whitespace-pre-wrap">{view.systemPrompt}</p>
          ) : (
            <p className="text-sm text-muted-foreground">None</p>
          )}
        </section>
        <section className="space-y-2" aria-label="Messages">
          <Heading>Messages</Heading>
          {view.messages.length === 0 && <p className="text-sm text-muted-foreground">No messages</p>}
          {view.messages.map((m, i) => (
            <div key={i} className="space-y-1 rounded-md border p-2" data-testid="sampling-message">
              <p className="text-xs font-semibold">{m.role}</p>
              <ContentView blocks={m.blocks} />
            </div>
          ))}
        </section>
        <section className="space-y-1" aria-label="Request settings">
          <Heading>Settings</Heading>
          <p className="text-sm">Max tokens: {view.maxTokens ?? 'not specified'}</p>
          <div className="space-y-1">
            <p className="text-sm">Model preferences:</p>
            <JsonView value={view.modelPreferences} />
          </div>
          {Object.keys(view.other).length > 0 && (
            <div className="space-y-1">
              <p className="text-sm">Other parameters:</p>
              <JsonView value={view.other} />
            </div>
          )}
        </section>
      </div>

      <section className="space-y-2" aria-label="Your reply">
        <Heading>Your reply (you play the model)</Heading>
        <Label htmlFor="sampling-reply" className="sr-only">
          Reply text
        </Label>
        <Textarea id="sampling-reply" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type the assistant reply…" />
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="sampling-model">Model name</Label>
            <Input id="sampling-model" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sampling-stop">Stop reason</Label>
            <Input id="sampling-stop" value={stopReason} onChange={(e) => setStopReason(e.target.value)} />
          </div>
        </div>
      </section>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => store.rejectRequest(request.id, samplingRejection(), 'Rejected')}>
          Reject
        </Button>
        <Button type="button" onClick={() => store.answer(request.id, buildSamplingResult({ text, model, stopReason }), 'Approved')}>
          Approve
        </Button>
      </DialogFooter>
    </>
  )
}

function FormElicitation({ request, message, schema }: { request: PendingRequest; message: string; schema: JsonSchema | null }) {
  const support = schema === null ? { ok: false as const, reason: 'The server did not send a requestedSchema.' } : supportsForm(schema)
  const form = schema !== null && support.ok ? schema : null
  const [value, setValue] = useState<FormValue>(() => (form ? initialFormValue(form) : undefined))
  const [rawText, setRawText] = useState('{}')
  const [errors, setErrors] = useState<FieldError[]>([])
  const store = useClientPending.getState()

  const respond = (action: ElicitAction) => {
    const outcome = action === 'accept' ? 'Accepted' : action === 'decline' ? 'Declined' : 'Cancelled'
    store.answer(request.id, buildElicitResult(action), outcome)
  }

  const accept = () => {
    let content: Record<string, unknown>
    if (form) {
      const r = toArguments(form, value)
      if (!r.ok) {
        setErrors(r.errors)
        return
      }
      content = r.arguments
    } else {
      const r = parseRawContent(rawText)
      if (!r.ok) {
        setErrors([{ path: '', message: r.error }])
        return
      }
      content = r.content
    }
    const bad = validateElicitContent(content)
    if (bad) {
      setErrors([{ path: '', message: bad }])
      return
    }
    setErrors([])
    store.answer(request.id, buildElicitResult('accept', content), 'Accepted')
  }

  const rootErrors = errors.filter((e) => e.path === '')

  return (
    <>
      <p className="text-sm break-words whitespace-pre-wrap" data-testid="elicit-message">
        {message}
      </p>
      <div className="max-h-[50vh] overflow-y-auto pr-1">
        {form ? (
          <SchemaForm schema={form} value={value} onChange={setValue} errors={errors} />
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {support.ok ? '' : `${support.reason} `}Enter the response as a JSON object.
            </p>
            <Label htmlFor="elicit-raw" className="sr-only">
              Response JSON
            </Label>
            <Textarea id="elicit-raw" className="font-mono text-xs" rows={6} value={rawText} onChange={(e) => setRawText(e.target.value)} />
          </div>
        )}
      </div>
      {rootErrors.length > 0 && (
        <ul role="alert" className="space-y-0.5 text-sm text-destructive">
          {rootErrors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => respond('cancel')}>
          Cancel
        </Button>
        <Button type="button" variant="outline" onClick={() => respond('decline')}>
          Decline
        </Button>
        <Button type="button" onClick={accept}>
          Accept
        </Button>
      </DialogFooter>
    </>
  )
}

function UrlElicitation({ request, message, url }: { request: PendingRequest; message: string; url: string }) {
  const analysis = analyzeUrl(url)
  const store = useClientPending.getState()
  const respond = (action: ElicitAction) => {
    const outcome = action === 'accept' ? 'Completed' : action === 'decline' ? 'Declined' : 'Cancelled'
    store.answer(request.id, buildElicitResult(action), outcome)
  }
  return (
    <>
      <p className="text-sm break-words whitespace-pre-wrap" data-testid="elicit-message">
        {message}
      </p>
      <section className="space-y-2 rounded-md border p-3" aria-label="Link">
        <Heading>This link points to</Heading>
        <p className="text-lg font-semibold break-all" data-testid="elicit-host">
          {analysis.host ?? 'unknown host'}
        </p>
        <p className="font-mono text-xs break-all" data-testid="elicit-url">
          {url}
        </p>
        {analysis.warnings.map((w) => (
          <p key={w} role="alert" className="text-xs text-destructive">
            {w}
          </p>
        ))}
        {analysis.refusal !== null && (
          <p role="alert" className="text-sm text-destructive" data-testid="elicit-refusal">
            {analysis.refusal}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!analysis.openable}
          onClick={() => {
            if (analysis.openable) window.open(url, '_blank', 'noopener,noreferrer')
          }}
        >
          Open link
        </Button>
      </section>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => respond('cancel')}>
          Cancel
        </Button>
        <Button type="button" variant="outline" onClick={() => respond('decline')}>
          Decline
        </Button>
        <Button type="button" onClick={() => respond('accept')}>
          I&apos;ve completed it
        </Button>
      </DialogFooter>
    </>
  )
}

function RequestDialog({ request, waiting }: { request: PendingRequest; waiting: number }) {
  const sampling = request.kind === 'sampling'
  const elicitation = request.kind === 'elicitation' ? parseElicitationParams(request.params) : null

  // Closing the dialog (Escape or the X button) is the safe answer: reject sampling, cancel elicitation.
  const dismiss = () => {
    const store = useClientPending.getState()
    if (sampling) store.rejectRequest(request.id, samplingRejection(), 'Rejected')
    else store.answer(request.id, buildElicitResult('cancel'), 'Cancelled')
  }

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        // A stray click outside must not answer a server request.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {sampling ? 'Sampling request' : elicitation?.mode === 'url' ? 'The server asks you to open a link' : 'The server asks for information'}
          </DialogTitle>
          <DialogDescription>
            The connected server sent this request. Nothing is answered until you respond.
            {waiting > 0 && <span className="ml-1 font-medium">{waiting} more waiting</span>}
          </DialogDescription>
        </DialogHeader>
        {sampling && <SamplingBody request={request} />}
        {elicitation?.mode === 'form' && <FormElicitation request={request} message={elicitation.message} schema={elicitation.schema} />}
        {elicitation?.mode === 'url' && <UrlElicitation request={request} message={elicitation.message} url={elicitation.url} />}
      </DialogContent>
    </Dialog>
  )
}

/** Shows the oldest pending server request in a modal dialog; the rest queue FIFO behind it. */
export default function ClientFeatureHost() {
  const first = useClientPending((s) => s.pending[0])
  const waiting = useClientPending((s) => Math.max(0, s.pending.length - 1))
  if (!first) return null
  return <RequestDialog key={first.id} request={first} waiting={waiting} />
}
