import { errorMessage } from '../connection/logic'
import { CHECK_STATUSES, type Check, type CheckContext, type CheckOutcome, type CheckResult } from './types'

/** A single check may take at most this long before it is recorded as failed. */
export const CHECK_TIMEOUT_MS = 15000

export interface RunOptions {
  /** Aborting stops the run: the check in flight and every unstarted check are recorded `skip` / `Cancelled`. */
  signal?: AbortSignal
  /** Called once per result, in run order. */
  onResult?: (r: CheckResult) => void
  /** Called right before a check starts. */
  onStart?: (id: string) => void
  timeoutMs?: number
}

export type RunBase = Omit<CheckContext, 'signal' | 'cache'>

function isOutcome(o: unknown): o is CheckOutcome {
  if (typeof o !== 'object' || o === null) return false
  const r = o as { status?: unknown; message?: unknown }
  return CHECK_STATUSES.includes(r.status as never) && typeof r.message === 'string'
}

async function runOne(
  check: Check,
  base: RunBase,
  cache: Map<string, unknown>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<CheckOutcome> {
  const own = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await new Promise<CheckOutcome>((resolve) => {
      timer = setTimeout(() => {
        own.abort()
        resolve({ status: 'fail', message: `Timed out after ${timeoutMs} ms` })
      }, timeoutMs)
      onAbort = () => {
        own.abort()
        resolve({ status: 'skip', message: 'Cancelled' })
      }
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      Promise.resolve()
        .then(() => check.run({ ...base, signal: own.signal, cache }))
        .then(
          (o) => resolve(isOutcome(o) ? o : { status: 'fail', message: 'Check returned an invalid result' }),
          (e: unknown) => resolve({ status: 'fail', message: `Check threw: ${errorMessage(e)}` }),
        )
    })
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Runs the checks one after another. Never throws. Every check yields exactly one result,
 * streamed through `onResult` in run order and also returned.
 */
export async function runChecks(checks: Check[], base: RunBase, o: RunOptions = {}): Promise<CheckResult[]> {
  const timeoutMs = o.timeoutMs ?? CHECK_TIMEOUT_MS
  const cache = new Map<string, unknown>()
  const results: CheckResult[] = []
  const emit = (r: CheckResult) => {
    results.push(r)
    try {
      o.onResult?.(r)
    } catch {
      // a failing listener must not break the run
    }
  }
  let cancelled = false
  for (const check of checks) {
    if (cancelled || o.signal?.aborted) {
      cancelled = true
      emit({ id: check.id, status: 'skip', message: 'Cancelled', durationMs: 0 })
      continue
    }
    try {
      o.onStart?.(check.id)
    } catch {
      // see above
    }
    const started = Date.now()
    const outcome = await runOne(check, base, cache, timeoutMs, o.signal)
    emit({ ...outcome, id: check.id, durationMs: Math.max(0, Date.now() - started) })
    if (o.signal?.aborted) cancelled = true
  }
  return results
}
