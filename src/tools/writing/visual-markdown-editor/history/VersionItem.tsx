/**
 * VersionItem — one row in the Version History list.
 *
 * Props-only, no store access. Clicking the row opens the detail view;
 * hover actions (Restore / Pin·Rename / Delete) are siblings of the row
 * button (never nested <button> inside <button>) and stop propagation so
 * they don't also trigger `onOpen`.
 */

import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Pin, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { countWords, formatVersionTime } from '../logic'
import { getVersionKind, versionTitle, VERSION_KIND_LABEL, type VersionKind } from './historyLogic'
import type { VmeVersion } from '../store'

// ── KindBadge ────────────────────────────────────────────────────────────────

/** Small badge/text showing whether a version is pinned, manual, or auto. */
export function KindBadge({ kind }: { kind: VersionKind }) {
  if (kind === 'pinned') {
    return (
      <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
        {VERSION_KIND_LABEL.pinned}
      </span>
    )
  }
  if (kind === 'manual') {
    return (
      <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
        {VERSION_KIND_LABEL.manual}
      </span>
    )
  }
  return <span className="shrink-0 text-[10px] text-muted-foreground/60">{VERSION_KIND_LABEL.auto}</span>
}

// ── PinLabelInput ────────────────────────────────────────────────────────────

interface PinLabelInputProps {
  initialLabel: string
  /** Label to fall back to when the committed value trims to empty. */
  fallbackLabel: string
  onCommit: (label: string) => void
  onCancel: () => void
  className?: string
}

/**
 * Inline rename/pin-label input shared by VersionItem and VersionDetail.
 * Enter commits, Escape cancels, blur commits — but Escape marks the input
 * as "resolved" first so the subsequent blur (from losing focus) doesn't
 * also fire a commit.
 */
export function PinLabelInput({ initialLabel, fallbackLabel, onCommit, onCancel, className }: PinLabelInputProps) {
  const [value, setValue] = useState(initialLabel)
  const inputRef = useRef<HTMLInputElement>(null)
  const resolvedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function commit() {
    if (resolvedRef.current) return
    resolvedRef.current = true
    const trimmed = value.trim()
    onCommit(trimmed || fallbackLabel)
  }

  function cancel() {
    if (resolvedRef.current) return
    resolvedRef.current = true
    onCancel()
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') cancel()
      }}
      onClick={(e) => e.stopPropagation()}
      placeholder="Name this version…"
      className={cn(
        'bg-background border border-input rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring',
        className,
      )}
    />
  )
}

// ── VersionItem ──────────────────────────────────────────────────────────────

interface VersionItemProps {
  version: VmeVersion
  onOpen: () => void
  onRestore: () => void
  onPin: (label: string) => void
  onDelete: () => void
}

export default function VersionItem({ version, onOpen, onRestore, onPin, onDelete }: VersionItemProps) {
  const [pinning, setPinning] = useState(false)
  const kind = getVersionKind(version)
  const title = versionTitle(version)
  const words = countWords(version.content)

  return (
    <div
      data-testid="version-row"
      className="group flex flex-col gap-1 px-3 py-2.5 border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
    >
      {/* Whole row (minus actions) opens the detail view */}
      <button type="button" onClick={onOpen} className="w-full min-w-0 flex flex-col gap-1 text-left">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="flex-1 min-w-0 text-xs font-medium text-foreground truncate" title={title}>
            {title}
          </span>
          <KindBadge kind={kind} />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
          </span>
          {version.label && (
            <>
              <span>·</span>
              <span>{formatVersionTime(version.savedAt)}</span>
            </>
          )}
        </div>
      </button>

      {pinning ? (
        <PinLabelInput
          initialLabel={version.label ?? ''}
          fallbackLabel={version.label ?? 'Pinned version'}
          onCommit={(label) => {
            onPin(label)
            setPinning(false)
          }}
          onCancel={() => setPinning(false)}
          className="mt-0.5 w-full"
        />
      ) : (
        <div className="flex items-center gap-1 mt-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRestore()
            }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted"
            title="Restore this version"
          >
            <RotateCcw className="h-3 w-3" />
            Restore
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setPinning(true)
            }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted"
            title={version.label ? 'Rename pin' : 'Pin this version'}
          >
            <Pin className="h-3 w-3" />
            {version.label ? 'Rename' : 'Pin'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors rounded px-1.5 py-0.5 hover:bg-destructive/10 ml-auto"
            title="Delete this version"
            aria-label="Delete version"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
