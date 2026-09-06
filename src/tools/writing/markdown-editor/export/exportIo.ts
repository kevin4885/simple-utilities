/**
 * exportIo
 *
 * Thin, side-effecting I/O wrappers used by the export UI (ExportMenu /
 * ExportDialog): file download via Blob + `<a download>`, rich-text
 * clipboard write with a plain-text fallback chain, and "print to PDF" via a
 * hidden sandboxed iframe (the browser's native print dialog, "Save as PDF").
 *
 * Everything that PRODUCES the HTML/markdown lives in `./exportHtml.tsx` —
 * this module only moves bytes around (download, clipboard, print).
 */

// ── Download ─────────────────────────────────────────────────────────────

/**
 * Trigger a browser download of `text` as `filename` with the given MIME
 * type. Uses a Blob + object URL + a transient `<a download>` click — the
 * same pattern the tool used inline before export was extracted.
 */
export function downloadText(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Rich-text clipboard ────────────────────────────────────────────────────

/**
 * Write `html` (as `text/html`) and `plain` (as `text/plain`) to the system
 * clipboard so pasting into a rich-text target (Word, Gmail, etc.) keeps
 * formatting. Falls back to a plain-text write if the Clipboard API's
 * `ClipboardItem`/`write` isn't available or throws, and reports `'failed'`
 * if even that fails — the caller decides how to surface each outcome.
 */
export async function copyRichText(html: string, plain: string): Promise<'rich' | 'plain' | 'failed'> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ])
      return 'rich'
    } catch {
      // fall through to plain-text fallback below
    }
  }

  try {
    await navigator.clipboard.writeText(plain)
    return 'plain'
  } catch {
    return 'failed'
  }
}

// ── Print (PDF via browser print dialog) ───────────────────────────────────

const IFRAME_LOAD_TIMEOUT_MS = 10_000
const AFTERPRINT_SAFETY_TIMEOUT_MS = 60_000

/**
 * Module-level singleton — only one export print iframe is "live" (i.e. the
 * most recent call) at a time. Each record carries its own `evict` so that a
 * newer `printHtml` call starting evicts exactly THAT call's iframe/timers —
 * never whatever a later call happens to have set `current` to by the time a
 * stale timer fires.
 */
type ActivePrint = { iframe: HTMLIFrameElement; evict: () => void }
let current: ActivePrint | null = null

/** Evict whatever the singleton currently holds (if anything): remove its
 * iframe from the DOM, clear its pending timers, and — if that call hadn't
 * settled yet — reject it with `Error('print-superseded')` so its promise
 * never hangs forever. Safe to call when nothing is current. */
function evictCurrent(): void {
  if (!current) return
  const { evict } = current
  current = null
  evict()
}

/**
 * Print `html` via a hidden, sandboxed iframe: load the document, wait for
 * fonts, focus the iframe's window, and call `print()` — this opens the
 * browser's native print dialog, from which the user can choose "Save as
 * PDF". The iframe is removed after printing (`afterprint`) or after a 60s
 * safety timeout, and any previous export iframe is removed first.
 *
 * `sandbox="allow-same-origin allow-modals"` — deliberately NOT
 * `allow-scripts`: `srcdoc` is our own generated HTML (see exportHtml.tsx —
 * no `<script>`, no raw-HTML passthrough), so the iframe never needs to run
 * script; `allow-modals` lets `print()` open its dialog.
 *
 * Concurrency: starting a new `printHtml` call while an earlier one still
 * owns the singleton (still loading, still awaiting `fonts.ready`, or still
 * waiting for `afterprint`/the safety timeout) evicts that earlier call
 * immediately — its iframe is removed and its timers cleared. If the earlier
 * call had not yet resolved, its promise rejects with
 * `Error('print-superseded')` instead of hanging or printing a detached
 * iframe.
 */
export function printHtml(html: string): Promise<void> {
  evictCurrent()

  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-same-origin allow-modals')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.title = 'Print preview'
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'

  return new Promise<void>((resolve, reject) => {
    let settled = false
    let loadTimeout: ReturnType<typeof setTimeout> | null = null
    let safetyTimeout: ReturnType<typeof setTimeout> | null = null

    function clearTimers(): void {
      if (loadTimeout) {
        clearTimeout(loadTimeout)
        loadTimeout = null
      }
      if (safetyTimeout) {
        clearTimeout(safetyTimeout)
        safetyTimeout = null
      }
    }

    function removeIframe(): void {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }

    // Self-scoped and idempotent: acts on THIS call's own iframe/timers only
    // — never on whatever the singleton currently holds. Used for the normal
    // afterprint / safety-timeout teardown of an already-resolved call.
    function cleanup(): void {
      clearTimers()
      if (current && current.iframe === iframe) current = null
      removeIframe()
    }

    // Called when a NEWER printHtml call evicts this one. Clears our timers
    // and removes our iframe unconditionally; additionally rejects our
    // promise if we hadn't settled yet (still loading / still awaiting
    // fonts.ready) so the promise can never be left pending forever.
    function evict(): void {
      clearTimers()
      removeIframe()
      if (!settled) {
        settled = true
        reject(new Error('print-superseded'))
      }
    }

    function fail(err: Error): void {
      if (settled) return
      settled = true
      clearTimers()
      if (current && current.iframe === iframe) current = null
      removeIframe()
      reject(err)
    }

    current = { iframe, evict }

    iframe.addEventListener('load', () => {
      void (async () => {
        // Already settled — either failed, or evicted by a newer call while
        // this frame was still loading. Nothing to do.
        if (settled) return
        const win = iframe.contentWindow
        if (!win) {
          fail(new Error('print-frame-load-failed'))
          return
        }

        try {
          await win.document.fonts?.ready
        } catch {
          // fonts not ready in time / unsupported — proceed anyway
        }

        // A newer `printHtml` call may have evicted us while we were
        // awaiting `fonts.ready` — `evict()` already settled (rejected) us
        // and removed our iframe; do not print a detached iframe.
        if (settled) return

        clearTimers()
        win.addEventListener('afterprint', cleanup)
        safetyTimeout = setTimeout(cleanup, AFTERPRINT_SAFETY_TIMEOUT_MS)

        try {
          win.focus()
          win.print()
        } catch (err) {
          fail(err instanceof Error ? err : new Error('print-failed'))
          return
        }

        settled = true
        resolve()
      })()
    })

    iframe.addEventListener('error', () => {
      fail(new Error('print-frame-load-failed'))
    })

    loadTimeout = setTimeout(() => {
      fail(new Error('print-frame-load-failed'))
    }, IFRAME_LOAD_TIMEOUT_MS)

    iframe.srcdoc = html
    document.body.appendChild(iframe)
  })
}
