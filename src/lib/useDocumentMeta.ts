/**
 * src/lib/useDocumentMeta.ts
 *
 * Sets the browser tab title and `<meta name="description">` content for the
 * current page. This is the **live client** counterpart to the (Phase 2)
 * build-time prerender script — both read title/description text from the
 * same source (`src/lib/content.ts` / `registry.ts`) so a freshly-loaded
 * static page and a client-side navigation always agree.
 *
 * Side effects only — no return value. Call once per page component, at the
 * top level (not conditionally).
 */

import { useEffect } from 'react'

export function useDocumentMeta(title: string, description: string): void {
  useEffect(() => {
    document.title = title

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'description')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', description)
  }, [title, description])
}
