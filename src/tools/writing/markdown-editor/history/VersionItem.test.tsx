import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VersionItem from './VersionItem'
import type { VmeVersion } from '../store'

function makeVersion(overrides: Partial<VmeVersion> = {}): VmeVersion {
  return {
    id: 'v1',
    content: 'hello world',
    savedAt: Date.now() - 60_000,
    auto: true,
    ...overrides,
  }
}

describe('VersionItem', () => {
  it('renders label as title and Pinned badge', () => {
    render(
      <VersionItem
        version={makeVersion({ label: 'Milestone', auto: false })}
        onOpen={vi.fn()}
        onRestore={vi.fn()}
        onPin={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('Milestone')).toBeInTheDocument()
    expect(screen.getByText('Pinned')).toBeInTheDocument()
  })

  it('unlabeled auto version shows relative time + Auto badge', () => {
    render(
      <VersionItem
        version={makeVersion({ auto: true })}
        onOpen={vi.fn()}
        onRestore={vi.fn()}
        onPin={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('Auto')).toBeInTheDocument()
    expect(screen.getByText('1 min ago')).toBeInTheDocument()
  })

  it('unlabeled manual version shows Manual badge', () => {
    render(
      <VersionItem
        version={makeVersion({ auto: false })}
        onOpen={vi.fn()}
        onRestore={vi.fn()}
        onPin={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('Manual')).toBeInTheDocument()
  })

  it('clicking the row calls onOpen', async () => {
    const onOpen = vi.fn()
    render(
      <VersionItem version={makeVersion()} onOpen={onOpen} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    await userEvent.click(screen.getByText('1 min ago'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('clicking Restore calls onRestore and not onOpen', async () => {
    const onOpen = vi.fn()
    const onRestore = vi.fn()
    render(
      <VersionItem version={makeVersion()} onOpen={onOpen} onRestore={onRestore} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    await userEvent.click(screen.getByTitle('Restore this version'))
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('Pin → input appears → type "Draft 1" + Enter → onPin("Draft 1")', async () => {
    const onPin = vi.fn()
    render(
      <VersionItem version={makeVersion()} onOpen={vi.fn()} onRestore={vi.fn()} onPin={onPin} onDelete={vi.fn()} />,
    )
    await userEvent.click(screen.getByTitle('Pin this version'))
    const input = screen.getByPlaceholderText('Name this version…')
    await userEvent.type(input, 'Draft 1')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPin).toHaveBeenCalledWith('Draft 1')
  })

  it('Escape cancels without calling onPin', async () => {
    const onPin = vi.fn()
    render(
      <VersionItem version={makeVersion()} onOpen={vi.fn()} onRestore={vi.fn()} onPin={onPin} onDelete={vi.fn()} />,
    )
    await userEvent.click(screen.getByTitle('Pin this version'))
    const input = screen.getByPlaceholderText('Name this version…')
    await userEvent.type(input, 'Draft 1')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onPin).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Name this version…')).not.toBeInTheDocument()
  })

  it('Delete calls onDelete', async () => {
    const onDelete = vi.fn()
    render(
      <VersionItem version={makeVersion()} onOpen={vi.fn()} onRestore={vi.fn()} onPin={vi.fn()} onDelete={onDelete} />,
    )
    await userEvent.click(screen.getByTitle('Delete this version'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('actions are keyboard-reachable: visible on focus-within and in tab order after the row button', async () => {
    const user = userEvent.setup()
    render(
      <VersionItem version={makeVersion()} onOpen={vi.fn()} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    const actionsContainer = screen.getByTitle('Restore this version').parentElement
    expect(actionsContainer).toHaveClass('group-focus-within:opacity-100')

    // Tab from the row-open button should reach the Restore button next.
    const rowButton = screen.getByText('1 min ago').closest('button')
    rowButton?.focus()
    await user.tab()
    expect(document.activeElement).toHaveTextContent('Restore')
  })
})
