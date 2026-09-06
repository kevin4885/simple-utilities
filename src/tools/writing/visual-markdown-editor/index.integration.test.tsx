/**
 * Integration test — VisualMarkdownEditorPage with the REAL TipTap
 * WysiwygEditor and the REAL CodeMirror CodeEditor.
 *
 * Every other VME page test (index.test.tsx) mocks WysiwygEditor and
 * CodeEditor to isolate the page's own wiring from the heavy editors. That
 * is valuable but leaves a real gap: the previous version-history review
 * only verified "Restore updates the visible editor" by code inspection,
 * never by actually mounting TipTap and reading its DOM. This file is the
 * ONLY VME page test that mounts the real editors — it exists specifically
 * to close that gap. Do not add a `vi.mock` for `WysiwygEditor`, `CodeEditor`,
 * or any TipTap module here; if a future change makes that necessary, treat
 * it as a regression to investigate, not a test to "fix" by mocking.
 *
 * Mocked here (heavy/irrelevant, not under test):
 *   - MarkdownRenderer (Preview mode — not exercised by these tests)
 *   - useMediaQuery (forced to desktop so the doc side panel + toolbar are
 *     both present in a single, deterministic layout)
 *
 * Polyfills: Radix Sheet (the history drawer) needs ResizeObserver in jsdom.
 * Added locally to this file only (src/test-setup.ts is intentionally left
 * untouched, per the phase brief).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VisualMarkdownEditorPage from './index'
import { useVmeStore } from './store'

// ---------------------------------------------------------------------------
// Mocks — only the irrelevant/heavy bits. WysiwygEditor and CodeEditor are
// the REAL implementations (real TipTap, real CodeMirror).
// ---------------------------------------------------------------------------

vi.mock('@/components/editor/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => <pre data-testid="md-preview">{content}</pre>,
}))

vi.mock('@/lib/useMediaQuery', () => ({
  useMediaQuery: () => true, // desktop
}))

// Radix Sheet (history drawer) needs ResizeObserver in jsdom.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).ResizeObserver ??= ResizeObserverMock

// jsdom does not implement Range.getClientRects()/getBoundingClientRect().
// ProseMirror's DOMObserver calls EditorView.coordsAtPos() on every selection
// change (including from a plain keystroke) to decide whether to scroll the
// selection into view — it needs *some* rect object back, not a throw.
// Real browsers return real rects; jsdom has neither method at all. Without
// this polyfill, typing into the real ProseMirror DOM throws synchronously
// inside jsdom's event dispatch (`target.getClientRects is not a function`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RangePrototype = (globalThis as any).Range?.prototype
if (RangePrototype && typeof RangePrototype.getClientRects !== 'function') {
  const zeroRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() { return this } })
  RangePrototype.getClientRects = () => [zeroRect()]
  RangePrototype.getBoundingClientRect = zeroRect
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function seedStore() {
  useVmeStore.setState({
    docs: [
      {
        id: 'd1',
        title: 'Doc',
        content: '# New',
        updatedAt: 1000,
        versions: [
          { id: 'v1', content: '# Old', savedAt: 0, auto: false, label: 'v1' },
        ],
      },
    ],
    activeDocId: 'd1',
    selectedModel: 'gpt4o',
    editorMode: 'wysiwyg',
    hintDismissed: true,
  })
}

beforeEach(() => {
  seedStore()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('VisualMarkdownEditorPage — real TipTap integration', () => {
  it('Restore updates the real WYSIWYG (ProseMirror) editor', async () => {
    const user = userEvent.setup()
    const { container } = render(<VisualMarkdownEditorPage />)

    // Real TipTap has mounted with the seeded content.
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeTruthy())
    expect(container.querySelector('.ProseMirror')!.textContent).toContain('New')

    // Open history → open the version row → Restore (in the detail view).
    await user.click(screen.getByLabelText('Version history'))
    await user.click(screen.getByText('v1'))
    const detail = screen.getByTestId('version-detail')
    await user.click(within(detail).getByText('Restore'))

    // The real ProseMirror DOM now reflects the restored content.
    await waitFor(() =>
      expect(container.querySelector('.ProseMirror')!.textContent).toContain('Old'),
    )

    const doc = useVmeStore.getState().docs[0]
    expect(doc.content).toBe('# Old')
    expect(doc.versions[0].label).toBe('Before restore')

    expect(screen.queryByTestId('version-detail')).not.toBeInTheDocument()
  })

  it('restored content shows in Markdown mode (real CodeMirror)', async () => {
    const user = userEvent.setup()
    const { container } = render(<VisualMarkdownEditorPage />)

    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeTruthy())

    await user.click(screen.getByLabelText('Version history'))
    await user.click(screen.getByText('v1'))
    const detail = screen.getByTestId('version-detail')
    await user.click(within(detail).getByText('Restore'))

    await waitFor(() =>
      expect(useVmeStore.getState().docs[0].content).toBe('# Old'),
    )

    // Switch to Markdown mode via the mode ToggleGroup (radiogroup of radios).
    await user.click(screen.getByRole('radio', { name: /markdown/i }))

    await waitFor(() =>
      expect(container.querySelector('.cm-content')).toBeTruthy(),
    )
    await waitFor(() =>
      expect(container.querySelector('.cm-content')!.textContent).toContain('Old'),
    )
  })

  it('opening the drawer without edits is a no-op on the doc (updatedAt + version count unchanged)', async () => {
    const user = userEvent.setup()
    const { container } = render(<VisualMarkdownEditorPage />)
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeTruthy())

    await user.click(screen.getByLabelText('Version history'))
    await waitFor(() => expect(screen.getAllByText('Version History').length).toBeGreaterThan(0))

    const doc = useVmeStore.getState().docs[0]
    expect(doc.updatedAt).toBe(1000)
    expect(doc.versions.length).toBe(1)
  })

  it('typing in the real WYSIWYG editor still updates the store (debounced flush)', async () => {
    const user = userEvent.setup()
    const { container } = render(<VisualMarkdownEditorPage />)

    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeTruthy())
    const proseMirror = container.querySelector('.ProseMirror') as HTMLElement

    proseMirror.focus()
    await user.keyboard(' more')

    await waitFor(() =>
      expect(useVmeStore.getState().docs[0].content).toContain('more'),
    )
  })
})
