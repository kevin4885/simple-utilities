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

export function useMediaQuery(query: string, defaultValue = false): boolean {
  // Memoize subscribe and getSnapshot so they are stable across renders
  // (avoids tearing down + re-adding the addEventListener on every render).
  // The MediaQueryList is created once per query inside the memo so
  // getSnapshot does not call matchMedia on every invocation.
  const [subscribe, getSnapshot, getServerSnapshot] = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      // SSR / jsdom without matchMedia — stable no-ops
      const sub = () => () => {}
      const snap = () => defaultValue
      const serverSnap = () => defaultValue
      return [sub, snap, serverSnap] as const
    }

    const mql = window.matchMedia(query)

    const sub = (callback: () => void) => {
      mql.addEventListener('change', callback)
      return () => mql.removeEventListener('change', callback)
    }

    const snap = () => mql.matches

    // getServerSnapshot must be a stable function returning the default value.
    // React uses this during SSR and hydration mismatch detection.
    const serverSnap = () => defaultValue

    return [sub, snap, serverSnap] as const
  }, [query, defaultValue])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
