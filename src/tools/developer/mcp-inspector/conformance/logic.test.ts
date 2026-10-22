import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpSession } from '../connection/session'
import type { ServerSummary } from '../connection/types'
import { buildMarkdown, buildReport, countResults } from './report'
import { CHECK_TIMEOUT_MS, runChecks, type RunBase } from './runner'
import type { Check, CheckOutcome, CheckResult } from './types'

const info: ServerSummary = {
  serverName: 'acme',
  serverVersion: '1.0.0',
  title: null,
  protocolVersion: '2025-06-18',
  capabilities: { tools: {} },
  instructions: null,
  transport: 'streamable-http',
  sessionId: 'SESSION-ID-9876',
}

const base: RunBase = {
  session: {} as McpSession,
  info,
  sessionOptions: {
    config: {
      url: 'https://mcp.test/mcp',
      transport: 'streamable-http',
      headers: [{ name: 'Authorization', value: 'Bearer SECRET' }],
      protocolVersion: null,
    },
  },
}

function check(id: string, run: Check['run']): Check {
  return { id, group: 'g', title: id, spec: 'spec', defaultOn: true, run }
}
const ok = (message = 'ok'): CheckOutcome => ({ status: 'pass', message })

describe('runChecks', () => {
  afterEach(() => vi.useRealTimers())

  it('runs checks sequentially and streams results in run order', async () => {
    const order: string[] = []
    let releaseA: () => void = () => undefined
    const a = check('a', () => new Promise((resolve) => {
      order.push('a:start')
      releaseA = () => {
        order.push('a:end')
        resolve(ok('A'))
      }
    }))
    const b = check('b', async () => {
      order.push('b:start')
      return { status: 'warn', message: 'B', detail: { x: 1 } }
    })
    const streamed: CheckResult[] = []
    const done = runChecks([a, b], base, { onResult: (r) => streamed.push(r) })
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['a:start']) // b has not started while a is pending
    releaseA()
    const results = await done
    expect(order).toEqual(['a:start', 'a:end', 'b:start'])
    expect(streamed.map((r) => r.id)).toEqual(['a', 'b'])
    expect(results).toEqual(streamed)
    expect(results[1]).toMatchObject({ id: 'b', status: 'warn', message: 'B', detail: { x: 1 } })
    expect(typeof results[0].durationMs).toBe('number')
  })

  it('records a throwing check as fail "Check threw: ..." and keeps going', async () => {
    const results = await runChecks(
      [
        check('boom', async () => {
          throw new Error('kaboom')
        }),
        check('after', async () => ok()),
      ],
      base,
    )
    expect(results[0]).toMatchObject({ id: 'boom', status: 'fail' })
    expect(results[0].message).toBe('Check threw: kaboom')
    expect(results[1]).toMatchObject({ id: 'after', status: 'pass' })
  })

  it('records a synchronously throwing check and a malformed result as fail', async () => {
    const results = await runChecks(
      [
        check('sync', (() => {
          throw new TypeError('sync boom')
        }) as unknown as Check['run']),
        check('bad-shape', (async () => ({ status: 'great', message: 'x' })) as unknown as Check['run']),
      ],
      base,
    )
    expect(results[0].message).toBe('Check threw: sync boom')
    expect(results[1]).toMatchObject({ status: 'fail', message: 'Check returned an invalid result' })
  })

  it('records a check exceeding 15000 ms as fail "Timed out after 15000 ms" and aborts its signal', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const hang = check('hang', (ctx) => {
      signal = ctx.signal
      return new Promise<CheckOutcome>(() => undefined)
    })
    const done = runChecks([hang, check('next', async () => ok())], base)
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS - 1)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const results = await done
    expect(CHECK_TIMEOUT_MS).toBe(15000)
    expect(results[0]).toMatchObject({ id: 'hang', status: 'fail', message: 'Timed out after 15000 ms' })
    expect(signal?.aborted).toBe(true)
    expect(results[1]).toMatchObject({ id: 'next', status: 'pass' })
  })

  it('abort stops the run: the running check and every unstarted check are skip "Cancelled"', async () => {
    const ac = new AbortController()
    const started: string[] = []
    const checks = [
      check('one', async () => {
        started.push('one')
        return ok()
      }),
      check('two', (ctx) => {
        started.push('two')
        return new Promise<CheckOutcome>(() => ctx.signal) // never settles on its own
      }),
      check('three', async () => {
        started.push('three')
        return ok()
      }),
    ]
    const streamed: string[] = []
    const done = runChecks(checks, base, {
      signal: ac.signal,
      onResult: (r) => {
        streamed.push(`${r.id}:${r.status}`)
      },
    })
    await vi.waitFor(() => expect(started).toEqual(['one', 'two']))
    ac.abort()
    const results = await done
    expect(started).toEqual(['one', 'two']) // three never started
    expect(results.map((r) => `${r.id}:${r.status}:${r.message}`)).toEqual(['one:pass:ok', 'two:skip:Cancelled', 'three:skip:Cancelled'])
    expect(streamed).toEqual(['one:pass', 'two:skip', 'three:skip'])
  })

  it('an already-aborted signal skips everything without running any check', async () => {
    const ac = new AbortController()
    ac.abort()
    const run = vi.fn(async () => ok())
    const results = await runChecks([check('a', run), check('b', run)], base, { signal: ac.signal })
    expect(run).not.toHaveBeenCalled()
    expect(results.every((r) => r.status === 'skip' && r.message === 'Cancelled')).toBe(true)
  })

  it('a throwing onResult listener does not break the run', async () => {
    const results = await runChecks([check('a', async () => ok()), check('b', async () => ok())], base, {
      onResult: () => {
        throw new Error('listener')
      },
    })
    expect(results).toHaveLength(2)
  })

  it('shares one cache per run between checks', async () => {
    const results = await runChecks(
      [
        check('w', async (ctx) => {
          ctx.cache.set('k', 42)
          return ok()
        }),
        check('r', async (ctx) => ({ status: 'pass', message: String(ctx.cache.get('k')) })),
      ],
      base,
    )
    expect(results[1].message).toBe('42')
  })
})

describe('report', () => {
  beforeEach(() => undefined)
  const results: CheckResult[] = [
    { id: 'a.one', status: 'pass', message: 'fine', durationMs: 3 },
    { id: 'a.two', status: 'fail', message: 'bad | pipe\nnew line', durationMs: 4, detail: { secret: 'SECRET' } },
    { id: 'a.three', status: 'warn', message: 'meh', durationMs: 1 },
    { id: 'a.four', status: 'skip', message: 'n/a', durationMs: 0 },
    { id: 'a.five', status: 'info', message: 'min 1 ms', durationMs: 9 },
  ]

  it('buildReport yields the documented shape', () => {
    const now = Date.UTC(2026, 0, 2, 3, 4, 5)
    const r = buildReport(results, info, now)
    expect(r.generatedAt).toBe('2026-01-02T03:04:05.000Z')
    expect(r.tool).toBe('Simple Utilities MCP Inspector')
    expect(r.server).toEqual({
      name: 'acme',
      version: '1.0.0',
      protocolVersion: '2025-06-18',
      transport: 'streamable-http',
      capabilities: { tools: {} },
    })
    expect(r.results[1]).toEqual({ id: 'a.two', status: 'fail', message: 'bad | pipe\nnew line' })
    expect(Object.keys(r.results[0]).sort()).toEqual(['id', 'message', 'status'])
    expect(r.counts).toEqual({ pass: 1, fail: 1, warn: 1, skip: 1, info: 1, total: 5 })
    expect(buildReport(results, info, new Date(now)).generatedAt).toBe(r.generatedAt)
  })

  it('contains no header value, token, session id or check detail', () => {
    const text = JSON.stringify(buildReport(results, info, 0)) + buildMarkdown(buildReport(results, info, 0))
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('Bearer')
    expect(text).not.toContain('SESSION-ID-9876')
    expect(text).not.toContain('Authorization')
  })

  it('scrubs known secrets out of messages (defence in depth)', () => {
    const leaky: CheckResult[] = [{ id: 'x', status: 'fail', message: 'server echoed SECRET123 and SESSION-ID-9876', durationMs: 0 }]
    const text = JSON.stringify(buildReport(leaky, info, 0, ['SECRET123', 'SESSION-ID-9876']))
    expect(text).not.toContain('SECRET123')
    expect(text).not.toContain('SESSION-ID-9876')
    expect(text).toContain('[redacted]')
  })

  it('countResults counts every status', () => {
    expect(countResults([])).toEqual({ pass: 0, fail: 0, warn: 0, skip: 0, info: 0, total: 0 })
    expect(countResults(results).total).toBe(5)
  })

  it('buildMarkdown makes a table and escapes pipes and newlines in messages', () => {
    const md = buildMarkdown(buildReport(results, info, 0))
    expect(md).toContain('| id | status | message |')
    expect(md).toContain('| a.one | pass | fine |')
    expect(md).toContain('| a.two | fail | bad \\| pipe new line |')
    const rows = md.split('\n').filter((l) => l.startsWith('| a.'))
    expect(rows).toHaveLength(5) // the newline did not break a row in two
    expect(md).toContain('Pass: 1 | Fail: 1 | Warn: 1 | Skip: 1 | Info: 1')
  })
})
