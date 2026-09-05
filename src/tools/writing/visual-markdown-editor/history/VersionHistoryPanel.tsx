/**
 * VersionHistoryPanel — list ⇄ detail state machine + header/footer.
 *
 * Props-only, never imports the store at runtime (only type-only imports
 * from ../store). Wrapped in a Sheet by VersionHistoryDrawer.tsx.
 */

import { useEffect, useRef, useState } from 'react'
import { History, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import VersionItem from './VersionItem'
import VersionDetail from './VersionDetail'
import { summarizeVersions } from './historyLogic'
import type { VmeDoc } from '../store'

export interface VersionHistoryPanelProps {
  doc: VmeDoc
  onClose: () => void
  /** Manual save; returns the new version's id, or null if nothing was saved. */
  onSaveVersion: () => string | null
  onRestore: (versionId: string) => void
  onPin: (versionId: string, label: string) => void
  onDelete: (versionId: string) => void
}

export default function VersionHistoryPanel({ doc, onClose, onSaveVersion, onRestore, onPin, onDelete }: VersionHistoryPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState(false)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset detail view when the active document changes. Adjusting state
  // during render (rather than in an effect) avoids the extra render pass
  // React flags as a cascading setState-in-effect.
  const [prevDocId, setPrevDocId] = useState(doc.id)
  if (doc.id !== prevDocId) {
    setPrevDocId(doc.id)
    setSelectedId(null)
  }

  // Clear the feedback timer on unmount.
  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  const selected = selectedId ? doc.versions.find((v) => v.id === selectedId) ?? null : null

  function handleSaveNow() {
    const result = onSaveVersion()
    if (result === null) {
      setFeedback(true)
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
      feedbackTimerRef.current = setTimeout(() => setFeedback(false), 2000)
    } else {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current)
        feedbackTimerRef.current = null
      }
      setFeedback(false)
    }
  }

  if (selected) {
    return (
      <VersionDetail
        version={selected}
        currentContent={doc.content}
        onBack={() => setSelectedId(null)}
        onRestore={() => {
          onRestore(selected.id)
          setSelectedId(null)
        }}
        onPin={(label) => onPin(selected.id, label)}
        onDelete={() => {
          onDelete(selected.id)
          setSelectedId(null)
        }}
      />
    )
  }

  const summary = summarizeVersions(doc.versions)

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 gap-2">
        <span className="text-sm font-semibold text-foreground">Version History</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {feedback && (
            <span data-testid="save-now-feedback" className="text-xs text-muted-foreground">
              Nothing new to save
            </span>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleSaveNow} title="Save a version now">
            <History className="h-3.5 w-3.5" />
            Save now
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {doc.versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 h-40 text-center px-6">
            <History className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No versions yet</p>
            <p className="text-xs text-muted-foreground/60">
              Versions are saved automatically after 5 minutes of inactivity, when you switch documents, or when you
              click &quot;Save now&quot;.
            </p>
          </div>
        ) : (
          doc.versions.map((v) => (
            <VersionItem
              key={v.id}
              version={v}
              onOpen={() => setSelectedId(v.id)}
              onRestore={() => onRestore(v.id)}
              onPin={(label) => onPin(v.id, label)}
              onDelete={() => onDelete(v.id)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {doc.versions.length > 0 && (
        <div className="px-4 py-2 border-t border-border shrink-0">
          <p className="text-[11px] text-muted-foreground/60 text-center">
            {summary.pinned} pinned · {summary.manual} manual · {summary.auto} auto · {summary.total} total
          </p>
        </div>
      )}
    </div>
  )
}
