/**
 * wysiwyg/WysiwygErrorBoundary.tsx
 *
 * Class-component error boundary wrapping <WysiwygEditor>.
 *
 * On error:
 *  1. Logs to console.error.
 *  2. Tries to flush pending edits via `flushRef.current?.flush()` so content
 *     is not lost even if the debounced onChange hadn't fired yet.
 *  3. Calls the `onError` prop (VME page uses this to switch mode to 'markdown').
 *  4. Renders a compact inline fallback notice visible while hasError=true.
 *     "Try visual mode again" calls reset() + onReset (parent switches back to
 *     'wysiwyg'), which causes React to remount the editor tree inside the
 *     now-reset boundary.
 *
 * Content safety: the store holds the markdown string as the single source of
 * truth. On error we attempt to flush any pending debounce so the last edit
 * reaches the store before the editor unmounts. The flush is guarded in
 * try/catch — if the editor is already in a broken state, we skip it silently
 * (the previous debounced write is the last-known-good state).
 *
 * Wiring in VME page: the boundary wraps the entire editor area (not just the
 * wysiwyg panel) so it remains mounted when onError switches mode. The fallback
 * notice is visible until the user clicks "Try visual mode again", which resets
 * the boundary AND asks the parent to re-enter wysiwyg mode (via onReset).
 *
 * Note: React error boundaries only catch render-phase errors (during React's
 * reconciliation pass). Errors thrown in event handlers or async ProseMirror
 * plugin transactions are NOT caught here.
 */

import { Component, type RefObject, type ErrorInfo, type ReactNode } from 'react'
import type { WysiwygEditorHandle } from './WysiwygEditor'

// ---------------------------------------------------------------------------
// Props / State
// ---------------------------------------------------------------------------

export interface WysiwygErrorBoundaryProps {
  children: ReactNode
  /** Called when an error is caught — use to switch mode to 'markdown'. */
  onError?: (error: Error, info: ErrorInfo) => void
  /**
   * Called when the user clicks "Try visual mode again" — use to switch mode
   * back to 'wysiwyg' so the editor remounts inside the now-reset boundary.
   */
  onReset?: () => void
  /**
   * Ref to the WysiwygEditor's imperative handle. On componentDidCatch we
   * try flush() to preserve any unwritten edits before the editor unmounts.
   */
  flushRef?: RefObject<WysiwygEditorHandle | null>
}

interface State {
  hasError: boolean
}

// ---------------------------------------------------------------------------
// WysiwygErrorBoundary
// ---------------------------------------------------------------------------

export class WysiwygErrorBoundary extends Component<WysiwygErrorBoundaryProps, State> {
  constructor(props: WysiwygErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // 1. Log to console
    console.error('[WysiwygErrorBoundary] Visual editor crashed:', error, info)

    // 2. Attempt to flush pending edits before the editor tree is replaced.
    //    Guard in try/catch — the editor may already be partially destroyed.
    try {
      this.props.flushRef?.current?.flush()
    } catch {
      // Flush failed — last debounced write is the last-known-good state.
    }

    // 3. Notify parent so it can switch to markdown mode
    this.props.onError?.(error, info)
  }

  reset() {
    this.setState({ hasError: false })
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="m-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-foreground"
        >
          <p className="font-medium">
            The visual editor hit a problem and was switched to Markdown mode.
            Your content is safe.
          </p>
          <button
            className="mt-2 rounded-md border border-border bg-background px-3 py-1 text-xs hover:bg-muted transition-colors"
            onClick={() => {
              this.reset()
              this.props.onReset?.()
            }}
          >
            Try visual mode again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
