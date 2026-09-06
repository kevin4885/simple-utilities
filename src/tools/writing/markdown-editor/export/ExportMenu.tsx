/**
 * ExportMenu
 *
 * The toolbar "Export ▾" dropdown that replaces the old plain `.md` download
 * button. Items: Markdown (.md) · Plain text (.txt) · Copy as rich text ·
 * (separator) · HTML… · PDF…. The last two open `ExportDialog`. Every action
 * calls `onBeforeExport` FIRST (the page uses this to flush the WYSIWYG
 * editor's debounced onChange) and only then reads `getContent()`, so the
 * export always reflects the latest keystrokes.
 */

import { useEffect, useRef, useState } from 'react'
import { Download, ChevronDown, FileText, AlignLeft, ClipboardCopy, FileCode2, Printer, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { buildExportFragment, htmlFragmentToPlainText, buildExportFilename } from './exportHtml'
import { downloadText, copyRichText } from './exportIo'
import type { ExportOptions } from './exportOptions'
import ExportDialog from './ExportDialog'

export interface ExportMenuProps {
  getContent: () => string
  title: string
  exportPrefs: ExportOptions
  onPrefsChange: (patch: Partial<ExportOptions>) => void
  onBeforeExport?: () => void
}

type CopyFeedback = 'rich' | 'plain' | 'failed' | 'export-failed' | null

const COPY_FEEDBACK_MS = 1800

export default function ExportMenu({
  getContent,
  title,
  exportPrefs,
  onPrefsChange,
  onBeforeExport,
}: ExportMenuProps) {
  const [dialog, setDialog] = useState<null | 'html' | 'pdf'>(null)
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  function showCopyFeedback(result: CopyFeedback) {
    setCopyFeedback(result)
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => {
      setCopyFeedback(null)
      feedbackTimerRef.current = null
    }, COPY_FEEDBACK_MS)
  }

  function handleDownloadMarkdown() {
    onBeforeExport?.()
    try {
      const content = getContent()
      downloadText(buildExportFilename(title, 'md'), 'text/markdown;charset=utf-8', content)
    } catch {
      showCopyFeedback('export-failed')
    }
  }

  function handleDownloadPlainText() {
    onBeforeExport?.()
    try {
      const content = getContent()
      const fragment = buildExportFragment(content, exportPrefs)
      const plain = htmlFragmentToPlainText(fragment)
      downloadText(buildExportFilename(title, 'txt'), 'text/plain;charset=utf-8', plain)
    } catch {
      showCopyFeedback('export-failed')
    }
  }

  async function handleCopyRichText() {
    onBeforeExport?.()
    try {
      const content = getContent()
      const fragment = buildExportFragment(content, exportPrefs)
      const result = await copyRichText(fragment, content)
      showCopyFeedback(result)
    } catch {
      showCopyFeedback('failed')
    }
  }

  function openDialog(format: 'html' | 'pdf') {
    onBeforeExport?.()
    setDialog(format)
  }

  const triggerLabel =
    copyFeedback === 'rich' ? 'Copied!' :
    copyFeedback === 'plain' ? 'Copied as plain text' :
    copyFeedback === 'failed' ? 'Copy failed' :
    copyFeedback === 'export-failed' ? 'Export failed' :
    'Export'

  const feedbackIsError = copyFeedback === 'failed' || copyFeedback === 'export-failed'

  const triggerIcon =
    feedbackIsError ? <X className="h-3.5 w-3.5 text-destructive" /> :
    copyFeedback === 'rich' || copyFeedback === 'plain' ? <Check className="h-3.5 w-3.5 text-green-500" /> :
    <Download className="h-3.5 w-3.5" />

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs shrink-0"
            aria-label="Export"
            title="Export"
          >
            {triggerIcon}
            <span className={copyFeedback ? (feedbackIsError ? 'text-destructive' : 'text-green-500') : 'hidden sm:inline'}>
              {copyFeedback ? triggerLabel : 'Export'}
            </span>
            {!copyFeedback && <ChevronDown className="h-3 w-3" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={handleDownloadMarkdown}>
            <FileText />
            Markdown (.md)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleDownloadPlainText}>
            <AlignLeft />
            Plain text (.txt)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleCopyRichText}>
            <ClipboardCopy />
            Copy as rich text
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openDialog('html')}>
            <FileCode2 />
            HTML…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog('pdf')}>
            <Printer />
            PDF…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog && (
        <ExportDialog
          open={dialog !== null}
          onOpenChange={(open) => { if (!open) setDialog(null) }}
          initialFormat={dialog}
          getContent={getContent}
          title={title}
          prefs={exportPrefs}
          onPrefsChange={onPrefsChange}
        />
      )}
    </>
  )
}
