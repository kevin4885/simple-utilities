/**
 * VersionDetail — Back · title · badge, Restore / Pin / Delete row, and
 * Preview / Changes tabs for a single version.
 */

import { useState } from 'react'
import { ArrowLeft, RotateCcw, Pin, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import MarkdownRenderer from '@/components/editor/MarkdownRenderer'
import { countWords } from '../logic'
import { versionTitle, getVersionKind } from './historyLogic'
import { KindBadge, PinLabelInput } from './VersionItem'
import VersionDiff from './VersionDiff'
import type { VmeVersion } from '../store'

export interface VersionDetailProps {
  version: VmeVersion
  currentContent: string
  onBack: () => void
  onRestore: () => void
  onPin: (label: string) => void
  onDelete: () => void
}

export default function VersionDetail({ version, currentContent, onBack, onRestore, onPin, onDelete }: VersionDetailProps) {
  const [pinning, setPinning] = useState(false)
  const kind = getVersionKind(version)
  const title = versionTitle(version)
  const words = countWords(version.content)

  return (
    <div data-testid="version-detail" className="flex flex-col h-full min-h-0">
      {/* Row 1: back + title + badge */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={onBack}
          aria-label="Back to list"
          title="Back to list"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="flex-1 min-w-0 text-sm font-medium text-foreground truncate" title={title}>
          {title}
        </span>
        <KindBadge kind={kind} />
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
        </span>
      </div>

      {/* Row 2: actions */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0">
        <Button size="sm" variant="default" className="h-7 text-xs gap-1.5" onClick={onRestore}>
          <RotateCcw className="h-3.5 w-3.5" />
          Restore
        </Button>
        {pinning ? (
          <PinLabelInput
            initialLabel={version.label ?? ''}
            fallbackLabel={version.label ?? 'Pinned version'}
            onCommit={(label) => {
              onPin(label)
              setPinning(false)
            }}
            onCancel={() => setPinning(false)}
            className="h-7 flex-1 min-w-0"
          />
        ) : (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setPinning(true)}>
            <Pin className="h-3.5 w-3.5" />
            {version.label ? 'Rename' : 'Pin'}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1.5 text-destructive hover:text-destructive ml-auto"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="preview" className="flex-1 min-h-0 flex flex-col gap-0">
        <TabsList className="shrink-0 mx-3 mt-2 self-start">
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="changes">Changes</TabsTrigger>
        </TabsList>
        <TabsContent value="preview" className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <MarkdownRenderer content={version.content} />
        </TabsContent>
        <TabsContent value="changes" className="flex-1 min-h-0 overflow-auto">
          <VersionDiff versionContent={version.content} currentContent={currentContent} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
