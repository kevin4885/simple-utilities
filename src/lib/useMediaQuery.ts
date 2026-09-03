/**
 * src/lib/useMediaQuery.ts
 *
 * React hook that returns true when the given CSS media query matches.
 *
 * Test-friendly: if matchMedia is not available (Node / jsdom without setup)
 * the hook returns `defaultValue` (default: false) and never throws.
 *
 * Example:
 *   const isDesktop = useMediaQuery('(min-width: 768px)')
 */

import { useState, useEffect } from 'react'

export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return defaultValue
    }
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)

    // Sync to current value when query changes (callback-based, not direct setState)
    onChange({ matches: mql.matches } as MediaQueryListEvent)

    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
