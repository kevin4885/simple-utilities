/**
 * VersionDiff — compact unified diff renderer for the history detail view.
 *
 * Wraps `computeVersionDiff` (from ./historyLogic, which wraps the pure
 * `computeDiff` from the Diff Viewer's logic.ts). Never imports
 * `diff-viewer/index.tsx` — the intraline span splitter is reimplemented
 * locally so this module has zero React dependency on that tool's UI.
 */

import { useMemo } from 'react'
import { computeVersionDiff, formatDiffStats, isIdentical } from './historyLogic'
import type { IntralineSpan } from '@/tools/developer/diff-viewer/logic'

// ── IntralineText (local reimplementation — do not import from diff-viewer/index.tsx) ──

function IntralineText({
  text,
  spans,
  markClassName,
}: {
  text: string
  spans: IntralineSpan[]
  markClassName: string
}) {
  if (spans.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let pos = 0
  let key = 0
  for (const span of spans) {
    if (span.start > pos) {
      parts.push(<span key={key++}>{text.slice(pos, span.start)}</span>)
    }
    parts.push(
      <mark key={key++} className={markClassName}>
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

// ── VersionDiff ──────────────────────────────────────────────────────────────

export interface VersionDiffProps {
  versionContent: string
  currentContent: string
}

export default function VersionDiff({ versionContent, currentContent }: VersionDiffProps) {
  const result = useMemo(() => computeVersionDiff(versionContent, currentContent), [versionContent, currentContent])

  if (!result.ok) {
    return (
      <p role="alert" className="text-xs text-destructive px-3 py-2">
        {result.error}
      </p>
    )
  }

  if (isIdentical(result)) {
    return <p className="text-xs text-muted-foreground px-3 py-4 text-center">Identical to current document</p>
  }

  return (
    <div className="overflow-auto">
      <div
        className="px-3 py-1.5 text-[11px] text-muted-foreground border-b border-border"
        title={formatDiffStats(result.stats)}
      >
        Changes since this version ·{' '}
        <span className="text-diff-insert">+{result.stats.additions}</span>{' '}
        <span className="text-diff-delete">{'\u2212'}{result.stats.deletions}</span>
      </div>
      {result.fallback && (
        <p className="px-3 py-1 text-[11px] text-muted-foreground italic">
          Large change — showing simplified diff
        </p>
      )}
      <div>
        {result.unified.map((row, i) => {
          const isDelete = row.type === 'delete'
          const isInsert = row.type === 'insert'
          const prefix = isDelete ? '−' : isInsert ? '+' : ' '
          return (
            <div
              key={i}
              data-testid="diff-row"
              data-type={row.type}
              className={
                isDelete
                  ? 'flex gap-1.5 px-2 py-0.5 bg-diff-delete/10 border-l-[3px] border-diff-delete/50 font-mono text-xs whitespace-pre-wrap break-words'
                  : isInsert
                    ? 'flex gap-1.5 px-2 py-0.5 bg-diff-insert/10 border-l-[3px] border-diff-insert/50 font-mono text-xs whitespace-pre-wrap break-words'
                    : 'flex gap-1.5 px-2 py-0.5 border-l-[3px] border-transparent font-mono text-xs whitespace-pre-wrap break-words'
              }
            >
              <span
                className={
                  isDelete
                    ? 'shrink-0 select-none text-diff-delete font-bold'
                    : isInsert
                      ? 'shrink-0 select-none text-diff-insert font-bold'
                      : 'shrink-0 select-none text-muted-foreground font-bold'
                }
              >
                {prefix}
              </span>
              <span className="min-w-0">
                <IntralineText
                  text={row.text}
                  spans={row.intralineSpans}
                  markClassName={
                    isDelete
                      ? 'bg-diff-delete/30 rounded-[2px] text-foreground'
                      : 'bg-diff-insert/30 rounded-[2px] text-foreground'
                  }
                />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
