import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('DiffViewer', () => {
  it('renders diff-insert / diff-delete token classes and no inline colour styles', async () => {
    const user = userEvent.setup()
    const { container } = render(<DiffViewer />)

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
    const { container } = render(<DiffViewer />)

    await user.type(screen.getByLabelText('Original'), 'a\nb')
    await user.type(screen.getByLabelText('Modified'), 'a\nc')

    const insertEl = container.querySelector('[class*="diff-insert"]')
    const deleteEl = container.querySelector('[class*="diff-delete"]')
    expect(insertEl).not.toBeNull()
    expect(deleteEl).not.toBeNull()

    expect(container.querySelectorAll('[style*="color"]').length).toBe(0)
  })
})
