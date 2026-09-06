/**
 * Tests for ExportDialog. `./exportIo` is mocked (downloadText/printHtml) so
 * no real Blob/iframe work happens here — only the wiring between the
 * dialog's controls, the pure builders, and those I/O calls is exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExportDialog from './ExportDialog'
import { DEFAULT_EXPORT_OPTIONS } from './exportOptions'
import { buildExportHtml, buildExportFilename } from './exportHtml'

const downloadTextMock = vi.fn()
const printHtmlMock = vi.fn()

vi.mock('./exportIo', () => ({
  downloadText: (...args: unknown[]) => downloadTextMock(...args),
  printHtml: (...args: unknown[]) => printHtmlMock(...args),
}))

beforeEach(() => {
  downloadTextMock.mockReset()
  printHtmlMock.mockReset().mockResolvedValue(undefined)
})

function renderDialog(overrides: Partial<Parameters<typeof ExportDialog>[0]> = {}) {
  const onOpenChange = vi.fn()
  const onPrefsChange = vi.fn()
  const props = {
    open: true,
    onOpenChange,
    initialFormat: 'html' as const,
    getContent: () => '# Hello',
    title: 'My Doc',
    prefs: DEFAULT_EXPORT_OPTIONS,
    onPrefsChange,
    ...overrides,
  }
  const utils = render(<ExportDialog {...props} />)
  return { ...utils, onOpenChange, onPrefsChange, props }
}

describe('ExportDialog', () => {
  it('renders "Export document" title and the format hint', () => {
    renderDialog()
    expect(screen.getByText('Export document')).toBeInTheDocument()
    expect(screen.getByText(/Self-contained \.html file/)).toBeInTheDocument()
  })

  it('HTML save: calls downloadText with buildExportFilename(title, "html") and buildExportHtml(...)', async () => {
    const { onOpenChange } = renderDialog({ initialFormat: 'html' })
    await userEvent.click(screen.getByRole('button', { name: 'Save HTML' }))

    expect(downloadTextMock).toHaveBeenCalledTimes(1)
    const [filename, mime, html] = downloadTextMock.mock.calls[0]
    expect(filename).toBe(buildExportFilename('My Doc', 'html'))
    expect(mime).toBe('text/html;charset=utf-8')
    expect(html).toBe(buildExportHtml('# Hello', 'My Doc', DEFAULT_EXPORT_OPTIONS))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('PDF: calls printHtml and closes the dialog on success', async () => {
    const { onOpenChange } = renderDialog({ initialFormat: 'pdf' })
    await userEvent.click(screen.getByRole('button', { name: 'Print to PDF' }))

    expect(printHtmlMock).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('PDF: shows "Preparing…" while pending, then the alert on rejection and stays open', async () => {
    let reject!: (err: Error) => void
    printHtmlMock.mockReturnValue(new Promise((_resolve, rej) => { reject = rej }))

    const { onOpenChange } = renderDialog({ initialFormat: 'pdf' })
    const button = screen.getByRole('button', { name: 'Print to PDF' })
    await userEvent.click(button)

    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled()

    reject(new Error('print-frame-load-failed'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't open the print dialog. Try HTML export instead.",
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: 'Print to PDF' })).not.toBeDisabled()
  })

  it('option toggles emit single-field patches via onPrefsChange', async () => {
    const { onPrefsChange } = renderDialog()

    await userEvent.click(screen.getByRole('radio', { name: 'GitHub' }))
    expect(onPrefsChange).toHaveBeenCalledWith({ preset: 'github' })

    await userEvent.click(screen.getByRole('radio', { name: 'A4' }))
    expect(onPrefsChange).toHaveBeenCalledWith({ paper: 'a4' })

    await userEvent.click(screen.getByRole('radio', { name: 'Narrow' }))
    expect(onPrefsChange).toHaveBeenCalledWith({ margins: 'narrow' })

    await userEvent.click(screen.getByLabelText('Include title and date'))
    expect(onPrefsChange).toHaveBeenCalledWith({ titleBlock: true })

    await userEvent.click(screen.getByLabelText('Show link URLs'))
    expect(onPrefsChange).toHaveBeenCalledWith({ showLinkUrls: false })
  })

  it('re-clicking the already-active preset toggle (Radix emits "") does not call onPrefsChange', async () => {
    const { onPrefsChange } = renderDialog()
    // 'document' is the default/active preset — clicking it again is a deselect.
    await userEvent.click(screen.getByRole('radio', { name: 'Document' }))
    expect(onPrefsChange).not.toHaveBeenCalled()
  })

  it('"Start each H1 on a new page" is disabled when format is HTML, enabled for PDF', async () => {
    renderDialog({ initialFormat: 'html' })
    expect(screen.getByLabelText('Start each H1 on a new page')).toBeDisabled()

    await userEvent.click(screen.getByRole('radio', { name: 'PDF' }))
    expect(screen.getByLabelText('Start each H1 on a new page')).not.toBeDisabled()
  })

  it('Cancel calls onOpenChange(false)', async () => {
    const { onOpenChange } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('the four ToggleGroups expose a programmatic group name', () => {
    renderDialog()
    expect(screen.getByRole('radiogroup', { name: 'Export format' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Style' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Paper' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Margins' })).toBeInTheDocument()
  })

  it('HTML save: a throwing builder shows "Couldn\'t create the file." and keeps the dialog open', async () => {
    const { onOpenChange } = renderDialog({
      initialFormat: 'html',
      getContent: () => {
        throw new Error('boom')
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Save HTML' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create the file.")
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(downloadTextMock).not.toHaveBeenCalled()
  })
})
