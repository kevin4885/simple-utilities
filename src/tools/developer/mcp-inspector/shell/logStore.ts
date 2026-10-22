import { create } from 'zustand'
import type { LogEntry, LogEntryInput } from '../connection/types'

export const LOG_CAP = 1000

/** Pure: returns a new array with `entry` appended, keeping at most `cap` entries (the OLDEST are dropped). */
export function appendCapped<T>(entries: readonly T[], entry: T, cap: number): T[] {
  const next = [...entries, entry]
  return next.length > cap ? next.slice(next.length - cap) : next
}

interface LogState {
  entries: LogEntry[]
  /** Next id to hand out. Never reset by clear(), so ids are never reused. */
  nextId: number
  append(e: LogEntryInput): void
  clear(): void
}

/** Runtime (NOT persisted) JSON-RPC / HTTP / event log. Ids are assigned here only. */
export const useLogStore = create<LogState>()((set) => ({
  entries: [],
  nextId: 1,
  append: (e) =>
    set((s) => ({
      entries: appendCapped(s.entries, { ...e, id: s.nextId } as LogEntry, LOG_CAP),
      nextId: s.nextId + 1,
    })),
  clear: () => set({ entries: [] }),
}))
