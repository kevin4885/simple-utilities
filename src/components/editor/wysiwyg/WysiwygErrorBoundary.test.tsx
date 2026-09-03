/**
 * wysiwyg/WysiwygErrorBoundary.test.tsx
 *
 * Unit tests for WysiwygErrorBoundary.
 * Tests: fallback renders on throw, onError called, reset restores children.
 *
 * Post-fix (Issue 4): the boundary no longer renders an inline fallback notice.
 * On error it renders null and calls onError (the page handles the banner and
 * mode switch). Tests updated accordingly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { WysiwygErrorBoundary } from './WysiwygErrorBoundary'
import type { WysiwygEditorHandle } from './WysiwygEditor'

/** A component that throws synchronously on render when `shouldThrow=true`. */
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test render error')
  }
  return <div data-testid="child">Normal child</div>
}

// Suppress expected error output during tests
let originalConsoleError: typeof console.error
beforeEach(() => {
  originalConsoleError = console.error
  console.error = vi.fn()
})
afterEach(() => {
  console.error = originalConsoleError
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WysiwygErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <WysiwygErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </WysiwygErrorBoundary>,
    )
    expect(screen.getByTestId('child')).toBeTruthy()
  })

  it('renders null (not a fallback notice) when child throws', () => {
    const { container } = render(
      <WysiwygErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </WysiwygErrorBoundary>,
    )
    // Boundary renders null — the container should be empty
    expect(container.firstChild).toBeNull()
    // No "Try visual mode again" inside the boundary
    expect(screen.queryByText('Try visual mode again')).toBeNull()
  })

  it('calls onError when child throws', () => {
    const onError = vi.fn()
    render(
      <WysiwygErrorBoundary onError={onError}>
        <ThrowingChild shouldThrow={true} />
      </WysiwygErrorBoundary>,
    )
    expect(onError).toHaveBeenCalledOnce()
    const [error] = onError.mock.calls[0]
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Test render error')
  })

  it('calls flushRef.current.flush() when child throws', () => {
    const flush = vi.fn()
    const flushRef = createRef<WysiwygEditorHandle | null>()
    // Assign via casting since refs to null are read-only via createRef
    ;(flushRef as { current: WysiwygEditorHandle }).current = { flush }

    render(
      <WysiwygErrorBoundary flushRef={flushRef}>
        <ThrowingChild shouldThrow={true} />
      </WysiwygErrorBoundary>,
    )
    expect(flush).toHaveBeenCalledOnce()
  })

  it('does not throw when flushRef.current is null', () => {
    const flushRef = createRef<WysiwygEditorHandle | null>()
    // flushRef.current is null (default for createRef)
    expect(() =>
      render(
        <WysiwygErrorBoundary flushRef={flushRef}>
          <ThrowingChild shouldThrow={true} />
        </WysiwygErrorBoundary>,
      ),
    ).not.toThrow()
  })

  it('restores children after mode-driven remount when child no longer throws', () => {
    // Simulate what the VME page does: on crash → mode switches to markdown
    // (boundary unmounts), user clicks "Try again" → mode switches back to
    // wysiwyg → a fresh boundary mounts around the wysiwyg panel.
    // Here we just verify that after a crash, removing the erroring child and
    // re-rendering produces a working tree.
    let shouldThrow = true

    function ControllableChild() {
      if (shouldThrow) throw new Error('controlled error')
      return <div data-testid="recovered-child">Recovered</div>
    }

    const { rerender } = render(
      <WysiwygErrorBoundary>
        <ControllableChild />
      </WysiwygErrorBoundary>,
    )

    // Error state — renders null
    expect(screen.queryByTestId('recovered-child')).toBeNull()

    // Simulate a fresh mount (what remounting via mode switch achieves)
    shouldThrow = false
    rerender(
      // Wrapping in a different key forces a clean remount
      <div key="remount">
        <WysiwygErrorBoundary>
          <ControllableChild />
        </WysiwygErrorBoundary>
      </div>,
    )

    // Now child renders normally
    expect(screen.getByTestId('recovered-child')).toBeTruthy()
  })
})
