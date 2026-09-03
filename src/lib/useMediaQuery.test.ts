/**
 * src/lib/useMediaQuery.test.ts
 *
 * Tests for the useSyncExternalStore-based useMediaQuery hook.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery } from './useMediaQuery'

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns defaultValue (false) when matchMedia is unavailable', () => {
    const original = window.matchMedia
    // @ts-expect-error -- simulate jsdom environment without matchMedia
    window.matchMedia = undefined
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))
    expect(result.current).toBe(false)
    window.matchMedia = original
  })

  it('returns defaultValue=true when matchMedia is unavailable and custom default provided', () => {
    const original = window.matchMedia
    // @ts-expect-error -- simulate jsdom environment without matchMedia
    window.matchMedia = undefined
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)', true))
    expect(result.current).toBe(true)
    window.matchMedia = original
  })

  it('returns true when matchMedia matches', () => {
    const mql = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList)
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))
    expect(result.current).toBe(true)
  })

  it('returns false when matchMedia does not match', () => {
    const mql = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList)
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))
    expect(result.current).toBe(false)
  })

  it('subscribes to change events and updates when mql fires', () => {
    let changeListener: ((e: MediaQueryListEvent) => void) | null = null
    const mql = {
      matches: false,
      addEventListener: vi.fn((_event: string, cb: (e: MediaQueryListEvent) => void) => {
        changeListener = cb
      }),
      removeEventListener: vi.fn(),
    }
    vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList)
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))
    expect(result.current).toBe(false)

    // Simulate media query change
    act(() => {
      // Update the mql and fire the listener
      mql.matches = true
      changeListener?.({ matches: true } as MediaQueryListEvent)
    })
    expect(result.current).toBe(true)
  })

  it('removes event listener on unmount', () => {
    const mql = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList)
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'))
    unmount()
    expect(mql.removeEventListener).toHaveBeenCalled()
  })
})
