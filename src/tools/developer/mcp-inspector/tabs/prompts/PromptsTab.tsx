import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { collectPages } from '../../connection/logic'
import type { McpSession } from '../../connection/session'
import { initialFormValue, SchemaForm, type FieldError, type FormValue } from '../../schema-form'
import { useMcpInspectorStore } from '../../store'
import { ContentView } from '../../shell/ContentView'
import type { TabProps } from '../../shell/logic'
import {
  buildPromptArguments,
  filterPrompts,
  parsePromptArguments,
  promptArgsToSchema,
  promptMessages,
  type PromptArgument,
  type PromptMessageView,
} from './logic'

// Everything the server sends (names, descriptions, message content) is rendered as React text children only.

type Rec = Record<string, unknown>

interface PromptItem {
  name: string
  title: string | null
  description: string | null
  arguments: PromptArgument[]
}

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; items: PromptItem[]; note: string | null }
  | { status: 'error'; message: string }

type GetState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; description: string | null; messages: PromptMessageView[] }
  | { status: 'error'; code: number | null; message: string }

const COMPLETION_DEBOUNCE_MS = 300
const MAX_SUGGESTIONS = 10

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const optStr = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function toPrompt(v: unknown): PromptItem | null {
  if (!isRec(v) || typeof v.name !== 'string') return null
  return {
    name: v.name,
    title: optStr(v.title),
    description: optStr(v.description),
    arguments: parsePromptArguments(v.arguments),
  }
}

async function loadPrompts(session: McpSession): Promise<ListState> {
  const r = await collectPages<unknown>(async (cursor) => {
    const res = await session.rawRequest('prompts/list', cursor ? { cursor } : {})
    if (!res.ok) throw new Error(res.error.message)
    const body = isRec(res.result) ? res.result : {}
    return {
      items: Array.isArray(body.prompts) ? (body.prompts as unknown[]) : [],
      nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : undefined,
    }
  })
  if (r.error !== null) return { status: 'error', message: r.error }
  return {
    status: 'ready',
    items: r.items.map(toPrompt).filter((p): p is PromptItem => p !== null),
    note: r.truncated ? `List truncated (${r.reason === 'cursor-loop' ? 'the server repeated a page cursor' : 'page limit reached'}).` : null,
  }
}
const PromptsTab: ComponentType<TabProps> = ({ session, info, profileId }) => {
  const pushHistory = useMcpInspectorStore((s) => s.pushHistory)
  const canComplete = Object.prototype.hasOwnProperty.call(info.capabilities, 'completions')

  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [form, setForm] = useState<FormValue>({})
  const [errors, setErrors] = useState<FieldError[]>([])
  const [get, setGet] = useState<GetState>({ status: 'idle' })
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({})

  const mounted = useRef(true)
  const listSeq = useRef(0)
  const getSeq = useRef(0)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const completionSeq = useRef(new Map<string, number>())

  const refresh = useCallback(async () => {
    const seq = ++listSeq.current
    const next = await loadPrompts(session)
    if (!mounted.current || seq !== listSeq.current) return
    setList(next)
  }, [session])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const off = session.onNotification('notifications/prompts/list_changed', () => void refresh())
    const pending = timers.current
    return () => {
      mounted.current = false
      off()
      for (const t of pending.values()) clearTimeout(t)
      pending.clear()
    }
  }, [session, refresh])

  const prompt = useMemo(
    () => (list.status === 'ready' && selected !== null ? (list.items.find((p) => p.name === selected) ?? null) : null),
    [list, selected],
  )
  const schema = useMemo(() => promptArgsToSchema(prompt?.arguments), [prompt])

  const select = (p: PromptItem) => {
    getSeq.current++
    for (const t of timers.current.values()) clearTimeout(t)
    timers.current.clear()
    setSelected(p.name)
    setForm(initialFormValue(promptArgsToSchema(p.arguments)))
    setErrors([])
    setSuggestions({})
    setGet({ status: 'idle' })
  }

  const onFormChange = (next: FormValue) => {
    setForm(next)
    if (!prompt || !canComplete) return
    const prev = isRec(form) ? form : {}
    const cur = isRec(next) ? next : {}
    for (const arg of prompt.arguments) {
      const value = cur[arg.name]
      if (value === prev[arg.name] || typeof value !== 'string') continue
      const existing = timers.current.get(arg.name)
      if (existing) clearTimeout(existing)
      const seq = (completionSeq.current.get(arg.name) ?? 0) + 1
      completionSeq.current.set(arg.name, seq)
      if (value === '') {
        setSuggestions((s) => ({ ...s, [arg.name]: [] }))
        continue
      }
      const others: Record<string, string> = {}
      for (const [k, v] of Object.entries(cur)) if (k !== arg.name && typeof v === 'string' && v !== '') others[k] = v
      timers.current.set(
        arg.name,
        setTimeout(() => {
          timers.current.delete(arg.name)
          void session
            .rawRequest('completion/complete', {
              ref: { type: 'ref/prompt', name: prompt.name },
              argument: { name: arg.name, value },
              ...(Object.keys(others).length > 0 ? { context: { arguments: others } } : {}),
            })
            .then((res) => {
              if (!mounted.current || completionSeq.current.get(arg.name) !== seq) return
              const completion = res.ok && isRec(res.result) && isRec(res.result.completion) ? res.result.completion : null
              const values = completion && Array.isArray(completion.values) ? completion.values : []
              setSuggestions((s) => ({
                ...s,
                [arg.name]: values.filter((x): x is string => typeof x === 'string').slice(0, MAX_SUGGESTIONS),
              }))
            })
        }, COMPLETION_DEBOUNCE_MS),
      )
    }
  }

  const applySuggestion = (name: string, value: string) => {
    const base = isRec(form) ? form : {}
    onFormChange({ ...base, [name]: value })
  }

  const doGet = async () => {
    if (!prompt) return
    const built = buildPromptArguments(schema, form)
    if (!built.ok) {
      setErrors(built.errors)
      return
    }
    setErrors([])
    const seq = ++getSeq.current
    setGet({ status: 'loading' })
    const res = await session.rawRequest('prompts/get', { name: prompt.name, arguments: built.arguments })
    pushHistory({
      profileId,
      kind: 'prompt',
      name: prompt.name,
      argsJson: JSON.stringify(built.arguments),
      ok: res.ok,
      durationMs: res.durationMs,
    })
    if (!mounted.current || seq !== getSeq.current) return
    if (!res.ok) {
      setGet({ status: 'error', code: res.error.code, message: res.error.message })
      return
    }
    setGet({
      status: 'done',
      description: isRec(res.result) ? optStr(res.result.description) : null,
      messages: promptMessages(res.result),
    })
  }

  const visible = list.status === 'ready' ? filterPrompts(list.items, query) : []

  return (
    <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <Input
          type="search"
          aria-label="Search prompts"
          placeholder="Search prompts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {list.status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
        {list.status === 'error' && (
          <div className="space-y-2">
            <p role="alert" className="text-sm break-words text-destructive">
              {list.message}
            </p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                setList({ status: 'loading' })
                void refresh()
              }}
            >
              Retry
            </Button>
          </div>
        )}
        {list.status === 'ready' && list.items.length === 0 && <p className="text-sm text-muted-foreground">No prompts.</p>}
        {list.status === 'ready' && list.note && <p className="text-xs text-muted-foreground">{list.note}</p>}
        {list.status === 'ready' && list.items.length > 0 && visible.length === 0 && (
          <p className="text-sm text-muted-foreground">No matching prompts.</p>
        )}
        <ul className="max-h-[32rem] space-y-1 overflow-auto">
          {visible.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                aria-pressed={selected === p.name}
                onClick={() => select(p)}
                className="w-full rounded-md border p-2 text-left text-sm hover:bg-accent aria-pressed:bg-accent"
              >
                <span className="block font-medium break-words">{p.title ?? p.name}</span>
                {p.title && <span className="block text-xs break-words text-muted-foreground">{p.name}</span>}
                {p.description && <span className="block text-xs break-words text-muted-foreground">{p.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-w-0 space-y-3">
        {!prompt ? (
          <p className="text-sm text-muted-foreground">Select a prompt.</p>
        ) : (
          <>
            <div>
              <h3 className="font-medium break-words">{prompt.title ?? prompt.name}</h3>
              {prompt.description && <p className="text-sm break-words text-muted-foreground">{prompt.description}</p>}
            </div>
            {prompt.arguments.length === 0 ? (
              <p className="text-sm text-muted-foreground">This prompt takes no arguments.</p>
            ) : (
              <SchemaForm schema={schema} value={form} onChange={onFormChange} errors={errors} disabled={get.status === 'loading'} />
            )}
            {prompt.arguments.some((a) => (suggestions[a.name]?.length ?? 0) > 0) && (
              <div className="space-y-2">
                {prompt.arguments.map((a) =>
                  (suggestions[a.name]?.length ?? 0) > 0 ? (
                    <div key={a.name} className="space-y-1">
                      <div className="text-xs text-muted-foreground">Suggestions for {a.name}</div>
                      <ul aria-label={`Suggestions for ${a.name}`} className="flex flex-wrap gap-1">
                        {suggestions[a.name].map((s) => (
                          <li key={s}>
                            <Button type="button" variant="outline" size="xs" onClick={() => applySuggestion(a.name, s)}>
                              {s}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null,
                )}
              </div>
            )}
            <Button type="button" size="sm" disabled={get.status === 'loading'} onClick={() => void doGet()}>
              Get prompt
            </Button>

            {get.status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
            {get.status === 'error' && (
              <div role="alert" className="rounded-md border border-destructive/50 p-3 text-sm">
                <div className="font-medium text-destructive">{get.code === null ? 'Request failed' : 'Protocol error'}</div>
                {get.code !== null && <div className="font-mono text-xs">Code {get.code}</div>}
                <div className="break-words whitespace-pre-wrap">{get.message}</div>
              </div>
            )}
            {get.status === 'done' && (
              <div className="space-y-3">
                {get.description && <p className="text-sm break-words text-muted-foreground">{get.description}</p>}
                {get.messages.length === 0 && <p className="text-sm text-muted-foreground">No messages.</p>}
                {get.messages.map((m, i) => (
                  <div key={i} className="space-y-1 rounded-md border p-2" data-testid="prompt-message">
                    <Badge variant={m.role === 'user' ? 'default' : 'secondary'}>{m.role}</Badge>
                    <ContentView blocks={m.content} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default PromptsTab
