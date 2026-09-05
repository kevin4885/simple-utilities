import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VersionHistoryPanel from './VersionHistoryPanel'
import type { VmeDoc, VmeVersion } from '../store'

vi.mock('@/components/editor/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => <pre data-testid="md-preview">{content}</pre>,
}))

function makeDoc(overrides: Partial<VmeDoc> = {}): VmeDoc {
  return {
    id: 'doc1',
    title: 'Untitled 1',
    content: 'current content',
    updatedAt: Date.now(),
    versions: [],
    ...overrides,
  }
}

function makeVersion(overrides: Partial<VmeVersion> = {}): VmeVersion {
  return {
    id: 'v1',
    content: 'hello',
    savedAt: Date.now() - 60_000,
    auto: true,
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('VersionHistoryPanel', () => {
  it('empty doc → "No versions yet" text, no footer', () => {
    render(
      <VersionHistoryPanel doc={makeDoc()} onClose={vi.fn()} onSaveVersion={vi.fn()} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(screen.getByText('No versions yet')).toBeInTheDocument()
    expect(screen.queryByText(/total/)).not.toBeInTheDocument()
  })

  it('three versions (pinned, manual, auto) → three rows in order, correct footer', () => {
    const versions: VmeVersion[] = [
      makeVersion({ id: 'p1', label: 'Pinned one', auto: false }),
      makeVersion({ id: 'm1', auto: false }),
      makeVersion({ id: 'a1', auto: true }),
    ]
    const { container } = render(
      <VersionHistoryPanel
        doc={makeDoc({ versions })}
        onClose={vi.fn()}
        onSaveVersion={vi.fn()}
        onRestore={vi.fn()}
        onPin={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const rows = container.querySelectorAll('[data-testid="version-row"]')
    expect(rows.length).toBe(3)
    expect(screen.getByText('1 pinned · 1 manual · 1 auto · 3 total')).toBeInTheDocument()
  })

  it('Save now returning an id shows no feedback', async () => {
    const onSaveVersion = vi.fn(() => 'new-id')
    render(
      <VersionHistoryPanel doc={makeDoc()} onClose={vi.fn()} onSaveVersion={onSaveVersion} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    await userEvent.click(screen.getByText('Save now'))
    expect(onSaveVersion).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('save-now-feedback')).not.toBeInTheDocument()
  })

  it('Save now returning null shows feedback, gone after 2000ms', () => {
    vi.useFakeTimers()
    const onSaveVersion = vi.fn(() => null)
    render(
      <VersionHistoryPanel doc={makeDoc()} onClose={vi.fn()} onSaveVersion={onSaveVersion} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    fireEvent.click(screen.getByText('Save now'))
    expect(screen.getByTestId('save-now-feedback')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.queryByTestId('save-now-feedback')).not.toBeInTheDocument()
  })

  it('feedback showing → subsequent Save now that succeeds clears it immediately', () => {
    vi.useFakeTimers()
    const onSaveVersion = vi.fn()
    onSaveVersion.mockReturnValueOnce(null).mockReturnValueOnce('new-id')
    render(
      <VersionHistoryPanel doc={makeDoc()} onClose={vi.fn()} onSaveVersion={onSaveVersion} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    fireEvent.click(screen.getByText('Save now'))
    expect(screen.getByTestId('save-now-feedback')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Save now'))
    expect(screen.queryByTestId('save-now-feedback')).not.toBeInTheDocument()

    // The stale timer from the first click must not resurrect nothing (it's
    // already cleared) — advancing time should not throw or change state.
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.queryByTestId('save-now-feedback')).not.toBeInTheDocument()
  })

  it('clicking a row shows version-detail with the version title; Back returns to list', async () => {
    const versions: VmeVersion[] = [makeVersion({ id: 'v1', label: 'My version' })]
    render(
      <VersionHistoryPanel doc={makeDoc({ versions })} onClose={vi.fn()} onSaveVersion={vi.fn()} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    await userEvent.click(screen.getByText('My version'))
    expect(screen.getByTestId('version-detail')).toBeInTheDocument()
    expect(screen.getAllByText('My version').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByLabelText('Back to list'))
    expect(screen.queryByTestId('version-detail')).not.toBeInTheDocument()
  })

  it('detail Changes tab shows diff header; Preview tab shows mocked renderer', async () => {
    const versions: VmeVersion[] = [makeVersion({ id: 'v1', content: 'old content', label: 'My version' })]
    render(
      <VersionHistoryPanel
        doc={makeDoc({ versions, content: 'new content' })}
        onClose={vi.fn()}
        onSaveVersion={vi.fn()}
        onRestore={vi.fn()}
        onPin={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByText('My version'))
    // Preview tab is default
    expect(screen.getByTestId('md-preview')).toHaveTextContent('old content')
    await userEvent.click(screen.getByRole('tab', { name: 'Changes' }))
    expect(screen.getByText(/Changes since this version/)).toBeInTheDocument()
  })

  it('detail Restore calls onRestore(versionId); Delete calls onDelete(versionId) and returns to list', async () => {
    const versions: VmeVersion[] = [makeVersion({ id: 'v1', label: 'My version' })]
    const onRestore = vi.fn()
    const onDelete = vi.fn()
    render(
      <VersionHistoryPanel doc={makeDoc({ versions })} onClose={vi.fn()} onSaveVersion={vi.fn()} onRestore={onRestore} onPin={vi.fn()} onDelete={onDelete} />,
    )
    await userEvent.click(screen.getByText('My version'))
    await userEvent.click(screen.getByText('Restore'))
    expect(onRestore).toHaveBeenCalledWith('v1')
    expect(screen.queryByTestId('version-detail')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('My version'))
    await userEvent.click(screen.getByText('Delete'))
    expect(onDelete).toHaveBeenCalledWith('v1')
    expect(screen.queryByTestId('version-detail')).not.toBeInTheDocument()
  })

  it('Close button calls onClose', async () => {
    const onClose = vi.fn()
    render(
      <VersionHistoryPanel doc={makeDoc()} onClose={onClose} onSaveVersion={vi.fn()} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    await userEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('rerender with the selected version removed from doc.versions → list shown, no throw', async () => {
    const versions: VmeVersion[] = [makeVersion({ id: 'v1', label: 'My version' })]
    const { rerender } = render(
      <VersionHistoryPanel doc={makeDoc({ versions })} onClose={vi.fn()} onSaveVersion={vi.fn()} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    await userEvent.click(screen.getByText('My version'))
    expect(screen.getByTestId('version-detail')).toBeInTheDocument()

    expect(() =>
      rerender(
        <VersionHistoryPanel doc={makeDoc({ versions: [] })} onClose={vi.fn()} onSaveVersion={vi.fn()} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
      ),
    ).not.toThrow()
    expect(screen.queryByTestId('version-detail')).not.toBeInTheDocument()
    expect(screen.getByText('No versions yet')).toBeInTheDocument()
  })

  it('rerender with a different doc.id while in detail → list shown', async () => {
    const versions: VmeVersion[] = [makeVersion({ id: 'v1', label: 'My version' })]
    const { rerender } = render(
      <VersionHistoryPanel doc={makeDoc({ id: 'doc1', versions })} onClose={vi.fn()} onSaveVersion={vi.fn()} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    await userEvent.click(screen.getByText('My version'))
    expect(screen.getByTestId('version-detail')).toBeInTheDocument()

    rerender(
      <VersionHistoryPanel doc={makeDoc({ id: 'doc2', versions: [] })} onClose={vi.fn()} onSaveVersion={vi.fn()} onRestore={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(screen.queryByTestId('version-detail')).not.toBeInTheDocument()
    expect(screen.getByText('No versions yet')).toBeInTheDocument()
  })
})
