/**
 * wysiwyg/WysiwygErrorBoundary.test.tsx
 *
 * Unit tests for WysiwygErrorBoundary.
 * Tests: fallback renders on throw, onError called, onReset called, reset restores children.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('renders fallback UI when child throws', () => {
    render(
      <WysiwygErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </WysiwygErrorBoundary>,
    )
    expect(screen.getByText(/The visual editor hit a problem/)).toBeTruthy()
    expect(screen.getByText('Try visual mode again')).toBeTruthy()
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

  it('calls onReset when "Try visual mode again" is clicked', () => {
    const onReset = vi.fn()
    render(
      <WysiwygErrorBoundary onReset={onReset}>
        <ThrowingChild shouldThrow={true} />
      </WysiwygErrorBoundary>,
    )
    fireEvent.click(screen.getByText('Try visual mode again'))
    expect(onReset).toHaveBeenCalledOnce()
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

  it('resets boundary when "Try visual mode again" is clicked', () => {
    render(
      <WysiwygErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </WysiwygErrorBoundary>,
    )

    // Fallback is visible
    expect(screen.getByText(/The visual editor hit a problem/)).toBeTruthy()

    // Click reset — ThrowingChild still throws, so boundary catches again
    fireEvent.click(screen.getByText('Try visual mode again'))

    // After reset, boundary renders children again (which still throw → shows fallback again)
    // This verifies the internal state was cleared and children were re-rendered
    expect(screen.getByText(/The visual editor hit a problem/)).toBeTruthy()
  })

  it('restores children after reset when child no longer throws', () => {
    // We use a mutable flag to control whether the child throws
    let shouldThrow = true

    function ControllableChild() {
      if (shouldThrow) throw new Error('controlled error')
      return <div data-testid="recovered-child">Recovered</div>
    }

    render(
      <WysiwygErrorBoundary>
        <ControllableChild />
      </WysiwygErrorBoundary>,
    )

    // Fallback shown
    expect(screen.getByText(/The visual editor hit a problem/)).toBeTruthy()

    // Stop throwing, then reset
    shouldThrow = false
    fireEvent.click(screen.getByText('Try visual mode again'))

    // Now child renders normally
    expect(screen.getByTestId('recovered-child')).toBeTruthy()
  })
})
