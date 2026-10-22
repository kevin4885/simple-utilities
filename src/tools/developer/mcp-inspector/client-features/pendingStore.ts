import { create } from 'zustand'
import { appendCapped } from '../shell/logStore'
import { MAX_RECENT, MAX_SERVER_LOGS, summarizeRequest, type AppliedSnapshot, type PendingKind } from './logic'

// Runtime (NOT persisted) state for server-originated requests and server log messages.
// The resolve / reject callbacks live in the store entries; they are never serialised.
// Every pending request carries the id of the client context (one per `configure(client)`) that created it,
// so tearing down connection N can never touch connection N+1's requests.

export interface PendingRequest {
  id: number
  /** The `configure(client)` call that registered the handler this request arrived on. */
  ctxId: number
  kind: PendingKind
  /** Untrusted server params - only ever rendered as text. */
  params: unknown
  receivedAt: number
  resolve(result: unknown): void
  reject(error: unknown): void
}

export interface AnsweredRequest {
  id: number
  kind: PendingKind
  summary: string
  outcome: string
  at: number
}

export interface ServerLogEntry {
  id: number
  ts: number
  level: string
  logger: string | null
  data: unknown
}

export interface EnqueueInput {
  ctxId: number
  kind: PendingKind
  params: unknown
  /** Aborts when the request is cancelled by the server or the connection closes. */
  signal?: AbortSignal
  now?: () => number
}

interface PendingState {
  pending: PendingRequest[]
  recent: AnsweredRequest[]
  nextId: number
  /** What the live connection was configured with (null when nothing is configured). */
  applied: { ctxId: number; snapshot: AppliedSnapshot } | null
  serverLogs: ServerLogEntry[]
  nextLogId: number
  /** Id of the session the current `serverLogs` belong to; a different session clears the list. */
  logOwner: number | null
  /** Queues a request FIFO and returns the promise the SDK handler awaits. */
  enqueue(input: EnqueueInput): Promise<unknown>
  /** Answers a request with a result. No-op when it is not pending any more. */
  answer(id: number, result: unknown, outcome: string): void
  /** Rejects a request (the SDK turns the error into a JSON-RPC error response). */
  rejectRequest(id: number, error: unknown, outcome: string): void
  /** Rejects and removes every request belonging to one client context. */
  disposeContext(ctxId: number, error: unknown): void
  setApplied(ctxId: number, snapshot: AppliedSnapshot): void
  clearApplied(ctxId: number): void
  claimLogs(owner: number): void
  addServerLog(e: Omit<ServerLogEntry, 'id'>): void
  clearServerLogs(): void
  reset(): void
}

const INITIAL = {
  pending: [] as PendingRequest[],
  recent: [] as AnsweredRequest[],
  nextId: 1,
  applied: null as PendingState['applied'],
  serverLogs: [] as ServerLogEntry[],
  nextLogId: 1,
  logOwner: null as number | null,
}

export const useClientPending = create<PendingState>()((set, get) => {
  /** Removes a pending request and records it as answered; returns it, or null if it was already gone. */
  function take(id: number, outcome: string): PendingRequest | null {
    const req = get().pending.find((p) => p.id === id)
    if (!req) return null
    set((s) => ({
      pending: s.pending.filter((p) => p.id !== id),
      recent: appendCapped(
        s.recent,
        { id: req.id, kind: req.kind, summary: summarizeRequest(req.kind, req.params), outcome, at: Date.now() },
        MAX_RECENT,
      ),
    }))
    return req
  }

  return {
    ...INITIAL,
    enqueue: ({ ctxId, kind, params, signal, now = Date.now }) =>
      new Promise<unknown>((resolve, reject) => {
        const id = get().nextId
        let onAbort: (() => void) | null = null
        const cleanup = () => {
          if (onAbort) signal?.removeEventListener('abort', onAbort)
        }
        const req: PendingRequest = {
          id,
          ctxId,
          kind,
          params,
          receivedAt: now(),
          resolve: (r) => {
            cleanup()
            resolve(r)
          },
          reject: (e) => {
            cleanup()
            reject(e)
          },
        }
        set((s) => ({ pending: [...s.pending, req], nextId: s.nextId + 1 }))
        if (signal) {
          onAbort = () => get().rejectRequest(id, new Error('Request cancelled'), 'Cancelled (connection closed or cancelled by server)')
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        }
      }),
    answer: (id, result, outcome) => take(id, outcome)?.resolve(result),
    rejectRequest: (id, error, outcome) => take(id, outcome)?.reject(error),
    disposeContext: (ctxId, error) => {
      for (const req of get().pending.filter((p) => p.ctxId === ctxId)) {
        take(req.id, 'Cancelled (disconnected)')?.reject(error)
      }
    },
    setApplied: (ctxId, snapshot) => set({ applied: { ctxId, snapshot } }),
    clearApplied: (ctxId) => set((s) => (s.applied?.ctxId === ctxId ? { applied: null } : s)),
    claimLogs: (owner) =>
      set((s) => (s.logOwner === owner ? s : { logOwner: owner, serverLogs: [], nextLogId: 1 })),
    addServerLog: (e) =>
      set((s) => ({
        serverLogs: appendCapped(s.serverLogs, { ...e, id: s.nextLogId }, MAX_SERVER_LOGS),
        nextLogId: s.nextLogId + 1,
      })),
    clearServerLogs: () => set({ serverLogs: [] }),
    reset: () => set({ ...INITIAL, pending: [], recent: [], serverLogs: [] }),
  }
})
