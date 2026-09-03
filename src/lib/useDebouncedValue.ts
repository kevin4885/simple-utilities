/**
 * useDebouncedValue — generic debounce hook
 *
 * Returns a version of `value` that only updates after `delayMs` ms of
 * inactivity. Useful for expensive derived state (token counts, search
 * indices) that should not run on every keystroke.
 */

import { useState, useEffect } from 'react'

/**
 * Debounces a value: the returned value only updates after the source
 * value has been stable for `delayMs` milliseconds.
 *
 * @param value   The live value to debounce.
 * @param delayMs Debounce delay in milliseconds.
 * @returns       The debounced value.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    // Always schedule via setTimeout (even with delayMs=0) to avoid calling
    // setState synchronously inside the effect body (lint: set-state-in-effect).
    const timer = setTimeout(() => setDebouncedValue(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debouncedValue
}
