/**
 * Tests for ExportMenu — wiring only (not ExportDialog internals, tested
 * separately). `./exportIo` is mocked so no real Blob/clipboard/iframe work
 * happens here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExportMenu from './ExportMenu'
import { DEFAULT_EXPORT_OPTIONS } from './exportOptions'

const downloadTextMock = vi.fn()
const copyRichTextMock = vi.fn()
const printHtmlMock = vi.fn()

vi.mock('./exportIo', () => ({
  downloadText: (...args: unknown[]) => downloadTextMock(...args),
  copyRichText: (...args: unknown[]) => copyRichTextMock(...args),
  printHtml: (...args: unknown[]) => printHtmlMock(...args),
}))

async function openMenu() {
  await userEvent.click(screen.getByLabelText('Export'))
}

beforeEach(() => {
  downloadTextMock.mockReset()
  copyRichTextMock.mockReset().mockResolvedValue('rich')
  printHtmlMock.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ExportMenu', () => {
  it('renders the trigger with aria-label "Export"', () => {
    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        getContent={() => '# hi'}
      />,
    )
    expect(screen.getByLabelText('Export')).toBeInTheDocument()
  })

  it('menu items render in the specified order', async () => {
    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        getContent={() => '# hi'}
      />,
    )
    await openMenu()
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(items).toEqual([
      'Markdown (.md)',
      'Plain text (.txt)',
      'Copy as rich text',
      'HTML…',
      'PDF…',
    ])
  })

  it('Markdown (.md): calls onBeforeExport before getContent, downloads the exact markdown', async () => {
    const order: string[] = []
    const onBeforeExport = vi.fn(() => order.push('flush'))
    const getContent = vi.fn(() => {
      order.push('getContent')
      return '# hello world'
    })

    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        onBeforeExport={onBeforeExport}
        getContent={getContent}
      />,
    )
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Markdown (.md)' }))

    expect(order).toEqual(['flush', 'getContent'])
    expect(downloadTextMock).toHaveBeenCalledWith('my-doc.md', 'text/markdown;charset=utf-8', '# hello world')
  })

  it('Plain text (.txt): downloads htmlFragmentToPlainText(buildExportFragment(content, prefs))', async () => {
    const getContent = vi.fn(() => '# Heading\n\nSome text.')

    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        getContent={getContent}
      />,
    )
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Plain text (.txt)' }))

    expect(downloadTextMock).toHaveBeenCalledTimes(1)
    const [filename, mime, text] = downloadTextMock.mock.calls[0]
    expect(filename).toBe('my-doc.txt')
    expect(mime).toBe('text/plain;charset=utf-8')
    expect(text).toContain('Heading')
    expect(text).toContain('Some text.')
  })

  it('Copy as rich text: rich result shows "Copied!" then reverts to "Export" after ~1.8s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    copyRichTextMock.mockResolvedValue('rich')

    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        getContent={() => 'hello'}
      />,
    )
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy as rich text' }))

    expect(await screen.findByText('Copied!')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1801)
    })
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('Export')).getByText('Export')).toBeInTheDocument()
  })

  it('Copy as rich text: "plain" result shows "Copied as plain text"', async () => {
    copyRichTextMock.mockResolvedValue('plain')

    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        getContent={() => 'hello'}
      />,
    )
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy as rich text' }))

    expect(await screen.findByText('Copied as plain text')).toBeInTheDocument()
  })

  it('Copy as rich text: "failed" result shows "Copy failed"', async () => {
    copyRichTextMock.mockResolvedValue('failed')

    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        getContent={() => 'hello'}
      />,
    )
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy as rich text' }))

    expect(await screen.findByText('Copy failed')).toBeInTheDocument()
  })

  it('Copy as rich text: "failed" result shows "Copy failed" in the destructive colour (not green)', async () => {
    copyRichTextMock.mockResolvedValue('failed')

    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        getContent={() => 'hello'}
      />,
    )
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy as rich text' }))

    const label = await screen.findByText('Copy failed')
    expect(label).toBeInTheDocument()
    expect(label).toHaveClass('text-destructive')
    expect(label).not.toHaveClass('text-green-500')
  })

  it('Copy as rich text: a throwing getContent shows "Copy failed" (destructive) and does not reach copyRichText', async () => {
    const getContent = vi.fn(() => {
      throw new Error('boom')
    })

    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        getContent={getContent}
      />,
    )
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy as rich text' }))

    const label = await screen.findByText('Copy failed')
    expect(label).toBeInTheDocument()
    expect(label).toHaveClass('text-destructive')
    expect(copyRichTextMock).not.toHaveBeenCalled()
  })

  it('Markdown (.md): a throwing getContent shows "Export failed" in the destructive colour and does not download', async () => {
    const getContent = vi.fn(() => {
      throw new Error('boom')
    })

    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        getContent={getContent}
      />,
    )
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Markdown (.md)' }))

    const label = await screen.findByText('Export failed')
    expect(label).toBeInTheDocument()
    expect(label).toHaveClass('text-destructive')
    expect(downloadTextMock).not.toHaveBeenCalled()
  })

  it('Plain text (.txt): a throwing downloadText shows "Export failed"', async () => {
    downloadTextMock.mockImplementation(() => {
      throw new Error('boom')
    })

    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        getContent={() => '# hi'}
      />,
    )
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Plain text (.txt)' }))

    expect(await screen.findByText('Export failed')).toBeInTheDocument()
  })
  it('HTML…: opens the dialog with "Save HTML" as the primary button and calls onBeforeExport', async () => {
    const onBeforeExport = vi.fn()
    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        onBeforeExport={onBeforeExport}
        getContent={() => '# hi'}
      />,
    )
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'HTML…' }))

    expect(await screen.findByText('Export document')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save HTML' })).toBeInTheDocument()
    expect(onBeforeExport).toHaveBeenCalled()
  })

  it('PDF…: opens the dialog with "Print to PDF" as the primary button', async () => {
    render(
      <ExportMenu
        title="My Doc"
        exportPrefs={DEFAULT_EXPORT_OPTIONS}
        onPrefsChange={vi.fn()}
        getContent={() => '# hi'}
      />,
    )
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'PDF…' }))

    expect(await screen.findByText('Export document')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print to PDF' })).toBeInTheDocument()
  })
})
