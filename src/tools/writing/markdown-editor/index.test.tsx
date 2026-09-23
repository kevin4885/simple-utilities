/**
 * Smoke tests for VisualMarkdownEditorPage — the toolbar History button and
 * the drawer wiring (flush discipline, restore, save now, doc switch).
 *
 * Heavy editors (WysiwygEditor, CodeEditor, MarkdownRenderer) are mocked so
 * these tests exercise only the page's own wiring, not TipTap/CodeMirror
 * internals.
 */
import { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VisualMarkdownEditorPage from './index'
import { useVmeStore, type VmeDoc } from './store'

// ---------------------------------------------------------------------------
// Mocks — heavy editors + media query + export I/O
// ---------------------------------------------------------------------------

const flushMock = vi.fn()
const downloadTextMock = vi.fn()

vi.mock('./export/exportIo', () => ({
  downloadText: (...args: unknown[]) => downloadTextMock(...args),
  copyRichText: vi.fn().mockResolvedValue('rich'),
  printHtml: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/components/editor/WysiwygEditor', () => {
  const MockWysiwygEditor = forwardRef<{ flush: () => void }, { value: string; onChange: (v: string) => void }>(
    function MockWysiwygEditor(_props, ref) {
      useImperativeHandle(ref, () => ({ flush: flushMock }))
      return <div data-testid="wysiwyg" />
    },
  )
  return { default: MockWysiwygEditor }
})

vi.mock('@/components/editor/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="code-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

vi.mock('@/components/editor/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => <pre data-testid="md-preview">{content}</pre>,
}))

vi.mock('@/lib/useMediaQuery', () => ({
  useMediaQuery: () => true, // desktop
}))

// Radix Sheet needs ResizeObserver in jsdom.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).ResizeObserver ??= ResizeObserverMock

function makeDoc(overrides: Partial<VmeDoc> = {}): VmeDoc {
  return {
    id: 'doc1',
    title: 'Untitled 1',
    content: 'hello',
    updatedAt: Date.now(),
    versions: [
      { id: 'v1', content: 'old', savedAt: Date.now() - 60_000, label: 'v1', auto: false },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  flushMock.mockClear()
  downloadTextMock.mockClear()
  useVmeStore.setState({
    docs: [makeDoc()],
    activeDocId: 'doc1',
    selectedModel: 'gpt4o',
    editorMode: 'markdown',
    hintDismissed: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('VisualMarkdownEditorPage — version history wiring', () => {
  it('renders the Version history button; clicking it opens the drawer', async () => {
    render(<VisualMarkdownEditorPage />)
    const button = screen.getByLabelText('Version history')
    expect(button).toBeInTheDocument()

    await userEvent.click(button)
    expect(screen.getAllByText('Version History').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('version-row').length).toBe(1)
  })

  it('Restore updates the store content, adds a "Before restore" pin, and closes the drawer', async () => {
    render(<VisualMarkdownEditorPage />)
    await userEvent.click(screen.getByLabelText('Version history'))

    await userEvent.click(screen.getByText('v1'))
    await userEvent.click(screen.getByText('Restore'))

    const doc = useVmeStore.getState().docs[0]
    expect(doc.content).toBe('old')
    expect(doc.versions[0].label).toBe('Before restore')

    expect(screen.queryByTestId('version-detail')).not.toBeInTheDocument()
    expect(screen.queryByText('Version History')).not.toBeInTheDocument()

    // Restored content is visible in the (mocked) code editor.
    const codeEditor = screen.getByTestId('code-editor') as HTMLTextAreaElement
    expect(codeEditor.value).toBe('old')
  })

  it('Save now adds a manual version', async () => {
    useVmeStore.setState({
      docs: [makeDoc({ content: 'fresh content that differs from any version' })],
      activeDocId: 'doc1',
    })
    render(<VisualMarkdownEditorPage />)
    await userEvent.click(screen.getByLabelText('Version history'))

    const before = useVmeStore.getState().docs[0].versions.length
    await userEvent.click(screen.getByText('Save now'))

    const after = useVmeStore.getState().docs[0].versions
    expect(after.length).toBe(before + 1)
    expect(after[0].auto).toBe(false)
  })

  it('opening the drawer in wysiwyg mode flushes the editor', async () => {
    useVmeStore.setState({ editorMode: 'wysiwyg' })
    render(<VisualMarkdownEditorPage />)
    await userEvent.click(screen.getByLabelText('Version history'))
    expect(flushMock).toHaveBeenCalled()
  })

  it('switching documents closes the drawer', async () => {
    useVmeStore.setState({
      docs: [makeDoc({ id: 'doc1', title: 'Doc A' }), makeDoc({ id: 'doc2', title: 'Doc B', versions: [] })],
      activeDocId: 'doc1',
    })
    render(<VisualMarkdownEditorPage />)
    await userEvent.click(screen.getByLabelText('Version history'))
    expect(screen.getAllByText('Version History').length).toBeGreaterThan(0)

    // Desktop doc list is a Collapsible with plain buttons for each doc.
    // fireEvent bypasses the pointer-events:none the open Sheet applies to
    // the rest of the page (Radix scroll-lock) — clicking through it is the
    // real user interaction we want to simulate the doc-switch effect of.
    fireEvent.click(within(screen.getByText('Doc B').closest('div')!).getByText('Doc B'))

    expect(screen.queryByText('Version History')).not.toBeInTheDocument()
  })
})

describe('VisualMarkdownEditorPage — export wiring', () => {
  it('Export → Markdown (.md) flushes the wysiwyg editor first when in wysiwyg mode', async () => {
    useVmeStore.setState({ editorMode: 'wysiwyg' })
    render(<VisualMarkdownEditorPage />)

    await userEvent.click(screen.getByLabelText('Export'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Markdown (.md)' }))

    expect(flushMock).toHaveBeenCalled()
    expect(downloadTextMock).toHaveBeenCalledTimes(1)
    const [, , content] = downloadTextMock.mock.calls[0]
    expect(content).toBe('hello')
  })
})
