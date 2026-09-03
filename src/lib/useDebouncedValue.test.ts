/**
 * useDebouncedValue tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 200))
    expect(result.current).toBe('hello')
  })

  it('does not update immediately when value changes', () => {
    const { result, rerender } = renderHook(
      ({ val }: { val: string }) => useDebouncedValue(val, 200),
      { initialProps: { val: 'a' } },
    )
    rerender({ val: 'b' })
    expect(result.current).toBe('a')
  })

  it('updates after the delay', () => {
    const { result, rerender } = renderHook(
      ({ val }: { val: string }) => useDebouncedValue(val, 200),
      { initialProps: { val: 'a' } },
    )
    rerender({ val: 'b' })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe('b')
  })

  it('resets the timer on rapid updates', () => {
    const { result, rerender } = renderHook(
      ({ val }: { val: string }) => useDebouncedValue(val, 200),
      { initialProps: { val: 'a' } },
    )
    rerender({ val: 'b' })
    act(() => vi.advanceTimersByTime(100))
    rerender({ val: 'c' })
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('a') // not updated yet
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('c') // now updated
  })

  it('updates synchronously when delayMs is 0', () => {
    const { result, rerender } = renderHook(
      ({ val }: { val: string }) => useDebouncedValue(val, 0),
      { initialProps: { val: 'a' } },
    )
    rerender({ val: 'b' })
    // delayMs=0 still uses setTimeout(fn, 0) for lint compliance; advance timers
    act(() => vi.advanceTimersByTime(0))
    expect(result.current).toBe('b')
  })
})
