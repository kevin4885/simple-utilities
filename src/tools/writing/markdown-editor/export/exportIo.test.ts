/**
 * Tests for exportIo — downloadText (Blob + object URL + <a download>),
 * copyRichText (Clipboard API with plain-text fallback chain), and
 * printHtml (hidden sandboxed iframe → contentWindow.print()).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadText, copyRichText, printHtml } from './exportIo'

// ---------------------------------------------------------------------------
// downloadText
// ---------------------------------------------------------------------------

describe('downloadText', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    createObjectURLSpy = vi.fn(() => 'blob:mock-url')
    revokeObjectURLSpy = vi.fn()
    // jsdom lacks URL.createObjectURL/revokeObjectURL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(URL as any).createObjectURL = createObjectURLSpy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(URL as any).revokeObjectURL = revokeObjectURLSpy
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    clickSpy.mockRestore()
  })

  it('creates a Blob URL, sets the download attr, clicks the anchor, revokes the URL', () => {
    downloadText('doc.md', 'text/markdown;charset=utf-8', '# Hello')

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob
    expect(blobArg.type).toBe('text/markdown;charset=utf-8')

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url')
  })
})

// ---------------------------------------------------------------------------
// copyRichText
// ---------------------------------------------------------------------------

/** Set/remove `globalThis.ClipboardItem` without an ASI-hazardous bare-paren
 * assignment statement (`(globalThis as any).X = …` can merge with the
 * previous line if it lacks a trailing semicolon) — always go through
 * `Object.defineProperty` instead. */
function setClipboardItem(value: unknown): void {
  Object.defineProperty(globalThis, 'ClipboardItem', { value, configurable: true, writable: true })
}

function setNavigatorClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

describe('copyRichText', () => {
  const originalClipboardItem = globalThis.ClipboardItem
  const originalClipboard = navigator.clipboard

  afterEach(() => {
    setClipboardItem(originalClipboardItem)
    setNavigatorClipboard(originalClipboard)
  })

  it('writes html+plain via ClipboardItem when available → "rich"', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboardItem(
      class {
        items: Record<string, Blob>
        constructor(items: Record<string, Blob>) {
          this.items = items
        }
      },
    )
    setNavigatorClipboard({ write, writeText })

    const result = await copyRichText('<p>hi</p>', 'hi')

    expect(result).toBe('rich')
    expect(write).toHaveBeenCalledTimes(1)
    const itemArg = write.mock.calls[0][0][0]
    expect(Object.keys(itemArg.items)).toEqual(['text/html', 'text/plain'])
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to writeText when ClipboardItem is undefined → "plain"', async () => {
    setClipboardItem(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigatorClipboard({ writeText })

    const result = await copyRichText('<p>hi</p>', 'hi')

    expect(result).toBe('plain')
    expect(writeText).toHaveBeenCalledWith('hi')
  })

  it('falls back to writeText when clipboard.write throws → "plain"', async () => {
    const write = vi.fn().mockRejectedValue(new Error('nope'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboardItem(
      class {
        constructor(public items: Record<string, Blob>) {}
      },
    )
    setNavigatorClipboard({ write, writeText })

    const result = await copyRichText('<p>hi</p>', 'hi')

    expect(result).toBe('plain')
    expect(writeText).toHaveBeenCalledWith('hi')
  })

  it('returns "failed" when both write and writeText throw', async () => {
    const write = vi.fn().mockRejectedValue(new Error('nope'))
    const writeText = vi.fn().mockRejectedValue(new Error('nope too'))
    setClipboardItem(
      class {
        constructor(public items: Record<string, Blob>) {}
      },
    )
    setNavigatorClipboard({ write, writeText })

    const result = await copyRichText('<p>hi</p>', 'hi')

    expect(result).toBe('failed')
  })

  it('returns "failed" when writeText throws and ClipboardItem is undefined', async () => {
    setClipboardItem(undefined)
    const writeText = vi.fn().mockRejectedValue(new Error('nope'))
    setNavigatorClipboard({ writeText })

    const result = await copyRichText('<p>hi</p>', 'hi')

    expect(result).toBe('failed')
  })
})

// ---------------------------------------------------------------------------
// printHtml
// ---------------------------------------------------------------------------

describe('printHtml', () => {
  afterEach(() => {
    vi.useRealTimers()
    // Remove any leftover iframes between tests.
    document.querySelectorAll('iframe').forEach((el) => el.remove())
  })

  function stubPrintableWindow(iframe: HTMLIFrameElement) {
    const win = iframe.contentWindow!
    win.print = vi.fn()
    win.focus = vi.fn()
    return win
  }

  it('appends exactly one hidden sandboxed iframe (no allow-scripts), calls print() after load, removes on afterprint', async () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild')

    const promise = printHtml('<p>hello</p>')

    // The iframe should have been appended synchronously.
    const iframe = document.body.querySelector('iframe') as HTMLIFrameElement
    expect(iframe).toBeTruthy()
    expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin allow-modals')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(iframe.style.visibility).toBe('hidden')

    const win = stubPrintableWindow(iframe)
    iframe.dispatchEvent(new Event('load'))

    await promise

    expect(win.print).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
    expect(appendSpy).toHaveBeenCalledTimes(1)

    // Simulate afterprint on the iframe's window — iframe should be removed.
    win.dispatchEvent(new Event('afterprint'))
    expect(document.body.querySelector('iframe')).toBeNull()

    appendSpy.mockRestore()
  })

  it('a second printHtml call removes the first iframe before creating a new one', async () => {
    const promise1 = printHtml('<p>first</p>')
    const iframe1 = document.body.querySelector('iframe') as HTMLIFrameElement
    stubPrintableWindow(iframe1)
    iframe1.dispatchEvent(new Event('load'))
    await promise1

    // iframe1 is still present (waiting for afterprint / safety timeout).
    expect(document.body.querySelectorAll('iframe').length).toBe(1)

    const promise2 = printHtml('<p>second</p>')
    // Old iframe removed synchronously by the new call.
    expect(document.body.querySelectorAll('iframe').length).toBe(1)
    const iframe2 = document.body.querySelector('iframe') as HTMLIFrameElement
    expect(iframe2).not.toBe(iframe1)

    stubPrintableWindow(iframe2)
    iframe2.dispatchEvent(new Event('load'))
    await promise2
  })

  it('rejects when the load event never fires within the timeout', async () => {
    vi.useFakeTimers()
    // jsdom fires a real `load` event once an iframe with `srcdoc` is
    // actually connected to the document — stub `appendChild` so the iframe
    // is never connected, simulating a load that never completes.
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as never)

    const promise = printHtml('<p>hello</p>')
    promise.catch(() => {}) // avoid unhandled-rejection noise before the assertion attaches
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(promise).rejects.toThrow('print-frame-load-failed')

    appendChildSpy.mockRestore()
    expect(document.body.querySelector('iframe')).toBeNull()
  })

  it('rejects on an error event', async () => {
    const promise = printHtml('<p>hello</p>')
    const iframe = document.body.querySelector('iframe') as HTMLIFrameElement
    iframe.dispatchEvent(new Event('error'))
    await expect(promise).rejects.toThrow('print-frame-load-failed')
    expect(document.body.querySelector('iframe')).toBeNull()
  })

  // ── Regression: fix round 1 — per-call timer/iframe isolation ────────────

  it("a superseded call's stale 60s safety timer must not remove the iframe of the call that superseded it", async () => {
    vi.useFakeTimers()

    // Call 1 loads and resolves — its 60s "afterprint safety" timer is now
    // armed (waiting for either `afterprint` or its own 60s timeout).
    const promise1 = printHtml('<p>first</p>')
    const iframe1 = document.body.querySelector('iframe') as HTMLIFrameElement
    stubPrintableWindow(iframe1)
    iframe1.dispatchEvent(new Event('load'))
    await promise1

    // Let most of call 1's 60s safety window elapse BEFORE call 2 starts.
    // This offset is essential: it's what exposes the old bug, where call
    // 1's and call 2's 60s timers were armed at the same fake timestamp and
    // a single 60s advance fired (and satisfied) both regardless of which
    // iframe each timer was "supposed" to own.
    await vi.advanceTimersByTimeAsync(55_000)

    // Call 2 evicts call 1 (removes iframe1, clears its timers) and starts
    // its own load/safety cycle.
    const promise2 = printHtml('<p>second</p>')
    const iframe2 = document.body.querySelector('iframe') as HTMLIFrameElement
    expect(iframe2).not.toBe(iframe1)
    stubPrintableWindow(iframe2)
    iframe2.dispatchEvent(new Event('load'))
    await promise2

    expect(document.body.contains(iframe1)).toBe(false)

    // Advance 6s: this crosses call 1's ORIGINAL 60s deadline (55 + 6 = 61s
    // since call 1's load) but is well before call 2's OWN 60s deadline
    // (only 6s since call 2's load). On the pre-fix aliasing bug, call 1's
    // stale timer fires here and tears down whatever iframe is "current" —
    // call 2's, even though call 2 has ~54s left on its own timer. On the
    // fixed code, call 1's timer was cleared synchronously at eviction, so
    // nothing fires here and iframe 2 survives.
    await vi.advanceTimersByTimeAsync(6_000)

    expect(document.body.contains(iframe2)).toBe(true)
    expect(document.body.querySelectorAll('iframe').length).toBe(1)

    // Now let call 2's own 60s safety timeout elapse — it (and only it) may
    // remove iframe 2.
    await vi.advanceTimersByTimeAsync(55_000)
    expect(document.body.querySelectorAll('iframe').length).toBe(0)
  })

  it("a superseded call's stale 10s load timer must not remove the successor iframe before its own load fires", async () => {
    vi.useFakeTimers()

    // jsdom fires a real `load` event once an iframe with `srcdoc` is
    // actually connected to the document. Stub `appendChild` for call 1 only
    // so its iframe never connects and never auto-loads — simulating a
    // load that never completes within the window we advance below.
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as never)
    const promise1 = printHtml('<p>first</p>')
    promise1.catch(() => {}) // rejection is asserted below; avoid unhandled-rejection noise in between
    appendChildSpy.mockRestore()

    // Let most of call 1's 10s load window elapse BEFORE call 2 starts.
    await vi.advanceTimersByTimeAsync(8_000)

    // Call 2 evicts call 1 (rejects it with print-superseded, clears its
    // timers) and starts its own load cycle.
    const promise2 = printHtml('<p>second</p>')
    await expect(promise1).rejects.toThrow('print-superseded')

    const iframe2 = document.body.querySelector('iframe') as HTMLIFrameElement
    stubPrintableWindow(iframe2)
    iframe2.dispatchEvent(new Event('load'))

    // Advance 3s: this crosses call 1's ORIGINAL 10s deadline (8 + 3 = 11s
    // since call 1 started) but is well before call 2's OWN 10s deadline.
    // On the pre-fix aliasing bug, call 1's stale load-timeout fires here
    // and fails/removes whatever iframe is "current" — call 2's, even
    // though it already loaded successfully. On the fixed code, call 1's
    // timer was cleared synchronously at eviction time.
    await vi.advanceTimersByTimeAsync(3_000)

    expect(document.body.contains(iframe2)).toBe(true)
    await expect(promise2).resolves.toBeUndefined()
  })

  it('a superseded call (evicted while awaiting fonts.ready) rejects with print-superseded and never calls print on its own window', async () => {
    const promise1 = printHtml('<p>first</p>')
    const iframe1 = document.body.querySelector('iframe') as HTMLIFrameElement
    const win1 = iframe1.contentWindow!
    win1.focus = vi.fn()
    // Simulate fonts.ready never settling for call 1 (e.g. a slow load) by
    // stubbing it with a promise we control, so we can reliably observe
    // eviction happening mid-await.
    let resolveFonts!: () => void
    Object.defineProperty(win1.document, 'fonts', {
      value: { ready: new Promise<void>((res) => { resolveFonts = res }) },
      configurable: true,
    })
    win1.print = vi.fn()

    iframe1.dispatchEvent(new Event('load'))
    // Call 1 is now awaiting fonts.ready — supersede it before it resolves.
    const promise2 = printHtml('<p>second</p>')
    // Stub iframe2's window immediately (before any await) so a real jsdom
    // auto-`load` event (srcdoc iframes load asynchronously in jsdom) can't
    // race ahead of this test's own control of when `load` fires.
    const iframe2 = document.body.querySelector('iframe') as HTMLIFrameElement
    stubPrintableWindow(iframe2)

    await expect(promise1).rejects.toThrow('print-superseded')
    expect(win1.print).not.toHaveBeenCalled()
    expect(document.body.contains(iframe1)).toBe(false)

    // Let call 1's fonts.ready resolve late — must be a no-op (already
    // settled/evicted), in particular must not call print() on the detached
    // iframe 1's window.
    resolveFonts()
    await Promise.resolve()
    await Promise.resolve()
    expect(win1.print).not.toHaveBeenCalled()

    iframe2.dispatchEvent(new Event('load'))
    await promise2
    expect((iframe2.contentWindow as unknown as { print: () => void }).print).toHaveBeenCalledTimes(1)
  })

  it('a throwing print() rejects printHtml and removes the iframe (does not hang)', async () => {
    const promise = printHtml('<p>hello</p>')
    const iframe = document.body.querySelector('iframe') as HTMLIFrameElement
    const win = iframe.contentWindow!
    win.focus = vi.fn()
    win.print = vi.fn(() => {
      throw new Error('print-not-implemented')
    })

    iframe.dispatchEvent(new Event('load'))

    await expect(promise).rejects.toThrow('print-not-implemented')
    expect(document.body.querySelector('iframe')).toBeNull()
  })
})
