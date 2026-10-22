import { beforeEach, describe, expect, it } from 'vitest'
import type { LogEntryInput } from '../connection/types'
import { appendCapped, LOG_CAP, useLogStore } from './logStore'

const ev = (text: string): LogEntryInput => ({ ts: 1, kind: 'event', level: 'info', text })

beforeEach(() => {
  useLogStore.getState().clear()
  useLogStore.setState({ nextId: 1 })
})

describe('appendCapped', () => {
  it('keeps at most cap entries and drops the oldest', () => {
    let list: number[] = []
    for (let i = 1; i <= 1005; i++) list = appendCapped(list, i, 1000)
    expect(list).toHaveLength(1000)
    expect(list[0]).toBe(6)
    expect(list[999]).toBe(1005)
  })

  it('does not mutate its input', () => {
    const input = [1, 2, 3]
    const out = appendCapped(input, 4, 3)
    expect(input).toEqual([1, 2, 3])
    expect(out).toEqual([2, 3, 4])
  })

  it('uses a cap of 1000 in the store', () => {
    expect(LOG_CAP).toBe(1000)
  })
})

describe('useLogStore', () => {
  it('assigns strictly increasing ids starting at 1', () => {
    const { append } = useLogStore.getState()
    append(ev('a'))
    append(ev('b'))
    append(ev('c'))
    expect(useLogStore.getState().entries.map((e) => e.id)).toEqual([1, 2, 3])
  })

  it('never reuses an id after clear()', () => {
    const { append, clear } = useLogStore.getState()
    append(ev('a'))
    append(ev('b'))
    clear()
    expect(useLogStore.getState().entries).toEqual([])
    append(ev('c'))
    expect(useLogStore.getState().entries.map((e) => e.id)).toEqual([3])
  })

  it('drops the oldest entries beyond the cap but keeps ids increasing', () => {
    const { append } = useLogStore.getState()
    for (let i = 0; i < 1003; i++) append(ev(String(i)))
    const entries = useLogStore.getState().entries
    expect(entries).toHaveLength(1000)
    expect(entries[0].id).toBe(4)
    expect(entries[999].id).toBe(1003)
  })
})
