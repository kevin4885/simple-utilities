/**
 * ExportDialog
 *
 * The "Export document" dialog (HTML/PDF) opened from ExportMenu's `HTML…`
 * and `PDF…` items. Lets the user pick a format (local, transient state)
 * and the persisted styling options (preset/paper/margins/title
 * block/link URLs/page-break-per-H1) — option changes are written straight
 * through `onPrefsChange` (the dialog never holds a private copy of
 * `exportPrefs`). On save it builds the export HTML from `getContent()` /
 * `title` / `prefs` (the same pure builders used everywhere else) and either
 * downloads a `.html` file or opens the browser's print dialog via
 * `printHtml`.
 */

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  PRESET_LABELS,
  PAPER_LABELS,
  MARGIN_LABELS,
  EXPORT_PRESETS,
  EXPORT_PAPERS,
  EXPORT_MARGINS,
  type ExportOptions,
} from './exportOptions'
import { buildExportHtml, buildExportFilename } from './exportHtml'
import { downloadText, printHtml } from './exportIo'

export interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialFormat: 'html' | 'pdf'
  getContent: () => string
  title: string
  prefs: ExportOptions
  onPrefsChange: (patch: Partial<ExportOptions>) => void
}

const FORMAT_HINTS: Record<'html' | 'pdf', string> = {
  html: 'Self-contained .html file — opens in any browser or Word.',
  pdf: "Your browser's print dialog opens — choose Save as PDF as the destination.",
}

export default function ExportDialog({
  open,
  onOpenChange,
  initialFormat,
  getContent,
  title,
  prefs,
  onPrefsChange,
}: ExportDialogProps) {
  const [format, setFormat] = useState<'html' | 'pdf'>(initialFormat)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'print' | 'html' | null>(null)

  function handleFormatChange(v: string) {
    if (v === 'html' || v === 'pdf') {
      setFormat(v)
      setError(null)
    }
  }

  async function handleSave() {
    setError(null)

    if (format === 'html') {
      try {
        const html = buildExportHtml(getContent(), title, prefs)
        downloadText(buildExportFilename(title, 'html'), 'text/html;charset=utf-8', html)
        onOpenChange(false)
      } catch {
        setError('html')
      }
      return
    }

    // PDF — open the browser's print dialog via the hidden print iframe.
    setBusy(true)
    try {
      const html = buildExportHtml(getContent(), title, prefs)
      await printHtml(html)
      setBusy(false)
      onOpenChange(false)
    } catch {
      setBusy(false)
      setError('print')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export document</DialogTitle>
          <DialogDescription>{FORMAT_HINTS[format]}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <ToggleGroup
            type="single"
            value={format}
            onValueChange={handleFormatChange}
            className="self-start"
            aria-label="Export format"
          >
            <ToggleGroupItem value="html">HTML</ToggleGroupItem>
            <ToggleGroupItem value="pdf">PDF</ToggleGroupItem>
          </ToggleGroup>

          <div className="flex flex-col gap-1.5">
            <Label id="export-style-label">Style</Label>
            <ToggleGroup
              type="single"
              value={prefs.preset}
              onValueChange={(v) => { if (v) onPrefsChange({ preset: v as ExportOptions['preset'] }) }}
              className="self-start"
              aria-labelledby="export-style-label"
            >
              {EXPORT_PRESETS.map((p) => (
                <ToggleGroupItem key={p} value={p}>{PRESET_LABELS[p]}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label id="export-paper-label">Paper</Label>
            <ToggleGroup
              type="single"
              value={prefs.paper}
              onValueChange={(v) => { if (v) onPrefsChange({ paper: v as ExportOptions['paper'] }) }}
              className="self-start"
              aria-labelledby="export-paper-label"
            >
              {EXPORT_PAPERS.map((p) => (
                <ToggleGroupItem key={p} value={p}>{PAPER_LABELS[p]}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label id="export-margins-label">Margins</Label>
            <ToggleGroup
              type="single"
              value={prefs.margins}
              onValueChange={(v) => { if (v) onPrefsChange({ margins: v as ExportOptions['margins'] }) }}
              className="self-start"
              aria-labelledby="export-margins-label"
            >
              {EXPORT_MARGINS.map((m) => (
                <ToggleGroupItem key={m} value={m}>{MARGIN_LABELS[m]}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Checkbox
                id="export-title-block"
                checked={prefs.titleBlock}
                onCheckedChange={(checked) => onPrefsChange({ titleBlock: checked === true })}
              />
              <Label htmlFor="export-title-block">Include title and date</Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="export-show-link-urls"
                checked={prefs.showLinkUrls}
                onCheckedChange={(checked) => onPrefsChange({ showLinkUrls: checked === true })}
              />
              <Label htmlFor="export-show-link-urls">Show link URLs</Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="export-page-break-h1"
                checked={prefs.pageBreakH1}
                disabled={format === 'html'}
                onCheckedChange={(checked) => onPrefsChange({ pageBreakH1: checked === true })}
              />
              <Label htmlFor="export-page-break-h1" className={format === 'html' ? 'text-muted-foreground' : ''}>
                Start each H1 on a new page
              </Label>
            </div>
          </div>

          {error === 'print' && (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t open the print dialog. Try HTML export instead.
            </p>
          )}
          {error === 'html' && (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t create the file.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? 'Preparing…' : format === 'html' ? 'Save HTML' : 'Print to PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
