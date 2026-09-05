/**
 * Diff Viewer
 *
 * Compare two text inputs (Original / Modified) line-by-line using a Myers diff
 * algorithm.  Features:
 *   – Unified view (single column, − / + rows)
 *   – Side-by-side view (two aligned columns with placeholder gaps)
 *   – Intraline char-level highlights within changed pairs
 *   – Ignore-whitespace and ignore-case toggles
 *   – Addition / deletion stats summary
 *   – All state persisted via Zustand store
 */

import { useDeferredValue, useMemo, useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { computeDiff } from './logic'
import type { UnifiedRow, SideBySideRow, IntralineSpan } from './logic'
import { useDiffViewerStore } from './store'
import { AlertTriangle, Copy, Check, Columns2, AlignLeft, ArrowUpDown } from 'lucide-react'

// ── IntralineText ──────────────────────────────────────────────────────────────

/**
 * Render a line of text with intraline span highlights.
 * Spans outside the changed chars are rendered as plain text.
 */
function IntralineText({
  text,
  spans,
  spanClassName,
}: {
  text: string
  spans: IntralineSpan[]
  spanClassName: string
}) {
  if (spans.length === 0) {
    return <>{text}</>
  }

  const parts: React.ReactNode[] = []
  let pos = 0
  let key = 0
  for (const span of spans) {
    if (span.start > pos) {
      parts.push(<span key={key++}>{text.slice(pos, span.start)}</span>)
    }
    parts.push(
      <mark key={key++} className={cn('rounded-[2px] text-foreground', spanClassName)}>
        {text.slice(span.start, span.end)}
      </mark>,
    )
    pos = span.end
  }
  if (pos < text.length) {
    parts.push(<span key={key++}>{text.slice(pos)}</span>)
  }
  return <>{parts}</>
}

// ── Gutter ─────────────────────────────────────────────────────────────────────

function Gutter({ lineNum }: { lineNum: number | null }) {
  return (
    <td className="select-none w-10 shrink-0 pr-2 text-right font-mono text-xs text-muted-foreground tabular-nums align-top py-0.5">
      {lineNum !== null ? lineNum : ''}
    </td>
  )
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard access denied — silently ignore
    }
  }, [text])
  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="p-1 rounded hover:bg-accent transition-colors"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  )
}

// ── UnifiedView ───────────────────────────────────────────────────────────────

function UnifiedView({ rows }: { rows: UnifiedRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic py-6 text-center">
        No lines to display.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs font-mono">
        <tbody>
          {rows.map((row, i) => {
            const isDelete = row.type === 'delete'
            const isInsert = row.type === 'insert'
            const spanClassName = isDelete ? 'bg-diff-delete/30' : 'bg-diff-insert/30'
            const prefix = isDelete ? '−' : isInsert ? '+' : ' '

            return (
              <tr
                key={i}
                className={cn(
                  isDelete && 'bg-diff-delete/10 border-l-[3px] border-l-diff-delete/50',
                  isInsert && 'bg-diff-insert/10 border-l-[3px] border-l-diff-insert/50',
                )}
              >
                {/* Prefix column */}
                <td className="select-none w-5 text-center align-top py-0.5 font-bold">
                  {isDelete && <span className="text-diff-delete">{prefix}</span>}
                  {isInsert && <span className="text-diff-insert">{prefix}</span>}
                  {!isDelete && !isInsert && (
                    <span className="text-muted-foreground">{prefix}</span>
                  )}
                </td>
                {/* Line number A */}
                <Gutter lineNum={row.lineA} />
                {/* Line number B */}
                <Gutter lineNum={row.lineB} />
                {/* Code cell */}
                <td className="py-0.5 pl-1 pr-2 whitespace-pre-wrap break-all leading-relaxed">
                  <IntralineText
                    text={row.text}
                    spans={row.intralineSpans}
                    spanClassName={spanClassName}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── SideBySideView ────────────────────────────────────────────────────────────

/** One cell in the side-by-side layout. */
function SideCell({
  text,
  spans,
  spanClassName,
  rowClassName,
  lineNum,
}: {
  text: string | null
  spans: IntralineSpan[]
  spanClassName: string
  rowClassName?: string
  lineNum: number | null
}) {
  return (
    <td
      className={cn('w-1/2 align-top border-r border-border last:border-r-0', rowClassName)}
    >
      <table className="w-full border-collapse">
        <tbody>
          <tr>
            <Gutter lineNum={lineNum} />
            <td className="py-0.5 pl-1 pr-2 text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">
              {text !== null ? (
                <IntralineText text={text} spans={spans} spanClassName={spanClassName} />
              ) : (
                // Placeholder gap — empty cell with muted background
                <span className="block min-h-[1.25em] bg-muted/40" />
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </td>
  )
}

function SideBySideView({ rows }: { rows: SideBySideRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic py-6 text-center">
        No lines to display.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row, i) => {
            const isContext = row.type === 'context'
            const isChanged = row.type === 'changed'
            const isDeleteOnly = row.type === 'delete-only'
            const isInsertOnly = row.type === 'insert-only'

            const leftClassName =
              isChanged || isDeleteOnly
                ? 'bg-diff-delete/10 border-l-[3px] border-l-diff-delete/50'
                : undefined
            const rightClassName =
              isChanged || isInsertOnly
                ? 'bg-diff-insert/10 border-l-[3px] border-l-diff-insert/50'
                : undefined

            return (
              <tr key={i} className={isContext ? '' : undefined}>
                <SideCell
                  text={isInsertOnly ? null : row.textA}
                  spans={isChanged ? row.intralineSpansA : []}
                  spanClassName="bg-diff-delete/30"
                  rowClassName={leftClassName}
                  lineNum={row.lineA}
                />
                <SideCell
                  text={isDeleteOnly ? null : row.textB}
                  spans={isChanged ? row.intralineSpansB : []}
                  spanClassName="bg-diff-insert/30"
                  rowClassName={rightClassName}
                  lineNum={row.lineB}
                />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── ViewToggle ────────────────────────────────────────────────────────────────

function ViewToggle({
  value,
  onChange,
}: {
  value: 'unified' | 'side-by-side'
  onChange: (v: 'unified' | 'side-by-side') => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-input p-0.5">
      <button
        type="button"
        onClick={() => onChange('unified')}
        aria-pressed={value === 'unified'}
        title="Unified view"
        className={cn(
          'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
          value === 'unified'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <AlignLeft className="h-3.5 w-3.5" />
        Unified
      </button>
      <button
        type="button"
        onClick={() => onChange('side-by-side')}
        aria-pressed={value === 'side-by-side'}
        title="Side-by-side view"
        className={cn(
          'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
          value === 'side-by-side'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Columns2 className="h-3.5 w-3.5" />
        Side by side
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DiffViewer() {
  const {
    original,
    modified,
    viewMode,
    ignoreWhitespace,
    ignoreCase,
    setOriginal,
    setModified,
    setViewMode,
    setIgnoreWhitespace,
    setIgnoreCase,
  } = useDiffViewerStore()

  // Defer expensive diff computation until the user pauses typing
  const deferredOriginal = useDeferredValue(original)
  const deferredModified = useDeferredValue(modified)
  const deferredIgnoreWs = useDeferredValue(ignoreWhitespace)
  const deferredIgnoreCase = useDeferredValue(ignoreCase)

  const diffResult = useMemo(
    () =>
      computeDiff(deferredOriginal, deferredModified, {
        ignoreWhitespace: deferredIgnoreWs,
        ignoreCase: deferredIgnoreCase,
      }),
    [deferredOriginal, deferredModified, deferredIgnoreWs, deferredIgnoreCase],
  )

  const hasContent = original.trim().length > 0 || modified.trim().length > 0

  // Swap inputs
  const handleSwap = useCallback(() => {
    const tmp = original
    setOriginal(modified)
    setModified(tmp)
  }, [original, modified, setOriginal, setModified])

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">

      {/* ── Inputs ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Original */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="diff-original" className="text-sm font-medium">
              Original
            </Label>
            <CopyButton text={original} />
          </div>
          <Textarea
            id="diff-original"
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
            placeholder="Paste original text here…"
            rows={10}
            className="font-mono text-xs resize-y"
            spellCheck={false}
          />
        </div>

        {/* Modified */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="diff-modified" className="text-sm font-medium">
              Modified
            </Label>
            <CopyButton text={modified} />
          </div>
          <Textarea
            id="diff-modified"
            value={modified}
            onChange={(e) => setModified(e.target.value)}
            placeholder="Paste modified text here…"
            rows={10}
            className="font-mono text-xs resize-y"
            spellCheck={false}
          />
        </div>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* View mode toggle */}
        <ViewToggle value={viewMode} onChange={setViewMode} />

        {/* Swap button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleSwap}
          className="gap-1.5 text-xs"
          title="Swap original and modified"
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          Swap
        </Button>

        <div className="flex items-center gap-4 ml-auto flex-wrap">
          {/* Ignore whitespace */}
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
            <Checkbox
              checked={ignoreWhitespace}
              onCheckedChange={(v) => setIgnoreWhitespace(v === true)}
              id="diff-ignore-ws"
            />
            <span className="text-sm text-foreground">Ignore whitespace</span>
          </label>

          {/* Ignore case */}
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
            <Checkbox
              checked={ignoreCase}
              onCheckedChange={(v) => setIgnoreCase(v === true)}
              id="diff-ignore-case"
            />
            <span className="text-sm text-foreground">Ignore case</span>
          </label>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {!diffResult.ok && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{diffResult.error}</span>
        </div>
      )}

      {/* ── Fallback warning ─────────────────────────────────────────────── */}
      {diffResult.ok && diffResult.fallback && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            The diff is very large (edit distance exceeded the limit). Showing a simplified
            all-delete / all-insert view; the content is complete but minimal edit grouping is
            not guaranteed.
          </span>
        </div>
      )}

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      {diffResult.ok && hasContent && (
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium tabular-nums text-diff-insert">
            +{diffResult.stats.additions} addition{diffResult.stats.additions !== 1 ? 's' : ''}
          </span>
          <span className="font-medium tabular-nums text-diff-delete">
            −{diffResult.stats.deletions} deletion{diffResult.stats.deletions !== 1 ? 's' : ''}
          </span>
          {diffResult.stats.additions === 0 && diffResult.stats.deletions === 0 && (
            <span className="text-muted-foreground">No differences found</span>
          )}
        </div>
      )}

      {/* ── Diff output ──────────────────────────────────────────────────── */}
      {diffResult.ok && hasContent && (
        <div className="rounded-lg border border-input bg-muted/10 overflow-hidden">
          {/* Column headers for side-by-side */}
          {viewMode === 'side-by-side' && (
            <div className="flex border-b border-input">
              <div className="w-1/2 px-3 py-2 text-xs font-medium text-muted-foreground border-r border-border">
                Original
              </div>
              <div className="w-1/2 px-3 py-2 text-xs font-medium text-muted-foreground">
                Modified
              </div>
            </div>
          )}

          <div className="overflow-auto max-h-[60vh]">
            {viewMode === 'unified' ? (
              <UnifiedView rows={diffResult.unified} />
            ) : (
              <SideBySideView rows={diffResult.sideBySide} />
            )}
          </div>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!hasContent && (
        <div className="rounded-lg border border-input bg-muted/10 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Paste text into both inputs above to see the diff.
          </p>
        </div>
      )}
    </div>
  )
}
