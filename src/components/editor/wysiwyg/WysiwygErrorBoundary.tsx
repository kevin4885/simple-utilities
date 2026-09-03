/**
 * wysiwyg/WysiwygErrorBoundary.tsx
 *
 * Class-component error boundary wrapping <WysiwygEditor>.
 *
 * On error:
 *  1. Logs to console.error.
 *  2. Tries to flush pending edits via `flushRef.current?.flush()` so content
 *     is not lost even if the debounced onChange hadn't fired yet.
 *  3. Calls the `onError` prop (VME page uses this to switch mode to 'markdown'
 *     and set a wysiwygError banner flag).
 *  4. Renders `null` — the boundary only wraps the wysiwyg panel (not the
 *     entire editor area), so switching mode to 'markdown' will unmount this
 *     boundary and show the CodeEditor. A compact error banner is rendered by
 *     the page above the mode content (see index.tsx — WysiwygCrashBanner).
 *
 * Simplified props vs old design:
 *   - No `onReset` prop needed — the boundary remounts automatically when the
 *     user clicks "Try visual mode again" in the page's banner: that action
 *     sets mode back to 'wysiwyg' which mounts a fresh boundary.
 *   - No internal fallback notice — the page owns the error state and banner.
 *
 * Content safety: the store holds the markdown string as the single source of
 * truth. On error we attempt to flush any pending debounce so the last edit
 * reaches the store before the editor unmounts. The flush is guarded in
 * try/catch — if the editor is already in a broken state, we skip it silently
 * (the previous debounced write is the last-known-good state).
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

    // 3. Notify parent so it can switch to markdown mode and show the banner
    this.props.onError?.(error, info)
  }

  override render() {
    if (this.state.hasError) {
      // Render nothing — the page switches mode to 'markdown' in onError,
      // which unmounts this boundary and shows the CodeEditor instead.
      // The crash banner is rendered by the page above the editor area.
      return null
    }

    return this.props.children
  }
}
