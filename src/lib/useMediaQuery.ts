/**
 * src/lib/useMediaQuery.ts
 *
 * React hook that returns true when the given CSS media query matches.
 *
 * Implementation: useSyncExternalStore (React 18+) — cleaner and correct
 * under React 19 concurrent mode than the previous useState+useEffect pattern.
 *
 * Test-friendly: if matchMedia is not available (Node / jsdom without setup)
 * the hook returns `defaultValue` (default: false) and never throws.
 *
 * Example:
 *   const isDesktop = useMediaQuery('(min-width: 768px)')
 */

import { useMemo, useSyncExternalStore } from 'react'

function getServerSnapshot(): boolean {
  return false
}

export function useMediaQuery(query: string, defaultValue = false): boolean {
  // ssrSnapshot — used on server and in environments without matchMedia
  const ssrSnapshot = defaultValue

  // Memoize subscribe and getSnapshot so they are stable across renders
  // (avoids tearing down + re-adding the addEventListener on every render).
  const [subscribe, getSnapshot] = useMemo(() => {
    const sub = (callback: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {}
      }
      const mql = window.matchMedia(query)
      mql.addEventListener('change', callback)
      return () => mql.removeEventListener('change', callback)
    }

    const snap = () => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return ssrSnapshot
      }
      return window.matchMedia(query).matches
    }

    return [sub, snap]
  }, [query, ssrSnapshot])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
