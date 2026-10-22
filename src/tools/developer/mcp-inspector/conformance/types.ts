import type { McpSession } from '../connection/session'
import type { LogEntryInput, ServerSummary, SessionOptions } from '../connection/types'

// Shared types for the conformance engine (checks.ts catalogue, runner.ts, report.ts).

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip' | 'info'

export const CHECK_STATUSES: readonly CheckStatus[] = ['pass', 'fail', 'warn', 'skip', 'info']

export interface CheckOutcome {
  status: CheckStatus
  message: string
  detail?: unknown
}

export interface CheckResult extends CheckOutcome {
  id: string
  /** Wall-clock milliseconds the check took (0 for checks that never started). */
  durationMs: number
}

export interface CheckContext {
  /** The connected session under test. */
  session: McpSession
  info: ServerSummary
  /** Options the live session was built from, so a check may open a THROWAWAY session (http.session-delete). */
  sessionOptions: Omit<SessionOptions, 'onLog' | 'onState'>
  /** Sink for the log entries of a throwaway session (so the Log drawer shows them). Optional. */
  onLog?: (e: LogEntryInput) => void
  /** Aborted when the run is cancelled or this check times out. */
  signal: AbortSignal
  /** Per-run memo shared by the checks (list results), so each list is fetched once per run. */
  cache: Map<string, unknown>
}

export interface Check {
  id: string
  group: string
  title: string
  /** One line: what this check protects. */
  spec: string
  defaultOn: boolean
  run(ctx: CheckContext): Promise<CheckOutcome>
}

export type CheckCounts = Record<CheckStatus, number> & { total: number }
