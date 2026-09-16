import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DiffViewer from './index'
import { useDiffViewerStore } from './store'

afterEach(() => {
  cleanup()
  useDiffViewerStore.setState({
    original: '',
    modified: '',
    viewMode: 'unified',
    ignoreWhitespace: false,
    ignoreCase: false,
  })
})

/**
 * `useDiffViewerStore` now always calls `useToolState` alongside the local
 * store (Rules of Hooks — see store.ts's Phase 3 migration), which needs a
 * `QueryClient` in the tree to not throw. The default `useAuth()` context
 * value is `status: 'loading'`, so these tests still exercise the same
 * signed-out/local-store path as before this migration — this wrapper exists
 * only to satisfy the always-mounted cloud hook, not because these tests
 * test the cloud path.
 */
function renderDiffViewer() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <DiffViewer />
    </QueryClientProvider>,
  )
}

describe('DiffViewer', () => {
  it('renders diff-insert / diff-delete token classes and no inline colour styles', async () => {
    const user = userEvent.setup()
    const { container } = renderDiffViewer()

    await user.type(screen.getByLabelText('Original'), 'a\nb')
    await user.type(screen.getByLabelText('Modified'), 'a\nc')

    const insertEl = container.querySelector('[class*="diff-insert"]')
    const deleteEl = container.querySelector('[class*="diff-delete"]')
    expect(insertEl).not.toBeNull()
    expect(deleteEl).not.toBeNull()

    expect(container.querySelectorAll('[style*="color"]').length).toBe(0)
  })

  it('renders diff-insert / diff-delete token classes in side-by-side view', async () => {
    const user = userEvent.setup()
    useDiffViewerStore.setState({ viewMode: 'side-by-side' })
    const { container } = renderDiffViewer()

    await user.type(screen.getByLabelText('Original'), 'a\nb')
    await user.type(screen.getByLabelText('Modified'), 'a\nc')

    const insertEl = container.querySelector('[class*="diff-insert"]')
    const deleteEl = container.querySelector('[class*="diff-delete"]')
    expect(insertEl).not.toBeNull()
    expect(deleteEl).not.toBeNull()

    expect(container.querySelectorAll('[style*="color"]').length).toBe(0)
  })
})
