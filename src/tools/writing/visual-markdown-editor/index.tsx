/**
 * Visual Markdown Editor — WYSIWYG editor tool page
 *
 * Modes (via ToggleGroup, persisted in store):
 *   Visual    → WysiwygEditor (TipTap) — rich text with toolbar + floating toolbar
 *   Markdown  → CodeEditor (CodeMirror, language="markdown")
 *   Preview   → MarkdownRenderer (read-only)
 *   Split     → ResizablePanelGroup: CodeEditor (left) | MarkdownRenderer (right)
 *               Below md breakpoint falls back to vertical split direction.
 *
 * All modes share the same markdown string from the store (single source of truth).
 * Switching modes never loses content. WysiwygEditor flushes pending onChange before
 * unmounting (via wysiwygRef.current?.flush()).
 *
 * Error boundary (Phase 4):
 *   WysiwygEditor is wrapped in WysiwygErrorBoundary. On any render crash the
 *   boundary catches, flushes pending edits, calls onError → mode switches to
 *   'markdown', and shows a brief inline notice.
 *
 * Keyboard shortcuts:
 *   Ctrl+Shift+P / Cmd+Shift+P — toggles between current editing mode and 'preview'
 *   (remembers previous mode to return to).
 *
 * Layout:
 *   Desktop (md+):
 *     [Center: mode switcher + editor area] [Right: collapsible doc list]
 *   Mobile (<md):
 *     Toolbar (mode switcher + actions) + editor area stacked; docs in Sheet
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type RefObject,
} from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Copy,
  Check,
  FileText,
  Download,
  Pencil,
  PanelLeft,
  Layers,
  Eye,
  Code2,
  Columns2,
  KeyboardIcon,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import WysiwygEditor, { type WysiwygEditorHandle } from '@/components/editor/WysiwygEditor'
import CodeEditor from '@/components/editor/CodeEditor'
import MarkdownRenderer from '@/components/editor/MarkdownRenderer'
import { WysiwygErrorBoundary } from '@/components/editor/wysiwyg/WysiwygErrorBoundary'
import {
  countTokensGpt,
  countTokensApprox,
  countWords,
  countChars,
  countLines,
  toSafeFilename,
  KEYBOARD_SHORTCUTS,
} from './logic'
import { useVmeStore, type VmeDoc, type VmeModel, type VmeEditorMode } from './store'

// ── Constants ─────────────────────────────────────────────────────────────────

const INACTIVITY_MS = 5 * 60 * 1000

const MODEL_LABELS: Record<VmeModel, string> = {
  gpt4o:  'GPT-4o',
  claude: 'Claude',
  gemini: 'Gemini',
}

const MODEL_CONTEXT: Record<VmeModel, string> = {
  gpt4o:  '128K ctx',
  claude: '200K ctx',
  gemini: '1M ctx',
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function getTokenCount(text: string, model: VmeModel): number {
  return model === 'gpt4o' ? countTokensGpt(text) : countTokensApprox(text)
}

function isApprox(model: VmeModel): boolean {
  return model !== 'gpt4o'
}

// ── DocSidePanel ──────────────────────────────────────────────────────────────

interface DocSidePanelProps {
  docs: VmeDoc[]
  activeDocId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
}

function DocSidePanel({
  docs,
  activeDocId,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: DocSidePanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit(doc: VmeDoc) {
    setEditingId(doc.id)
    setEditValue(doc.title)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim())
    }
    setEditingId(null)
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Documents
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onNew}
          title="New document"
          aria-label="New document"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Doc list */}
      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        {docs.map((doc) => {
          const isActive  = doc.id === activeDocId
          const isEditing = editingId === doc.id
          return (
            <div
              key={doc.id}
              className={cn(
                'group flex items-center gap-1.5 px-2 py-1.5 mx-1 rounded-md cursor-pointer transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted/60 text-foreground',
              )}
              onClick={() => !isEditing && onSelect(doc.id)}
            >
              <FileText
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
              />

              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 min-w-0 bg-background border border-input rounded px-1 py-0 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="flex-1 min-w-0 text-xs truncate"
                  onDoubleClick={() => startEdit(doc)}
                  title={doc.title}
                >
                  {doc.title}
                </span>
              )}

              {!isEditing && (
                <button
                  className={cn(
                    'shrink-0 rounded p-0.5 transition-colors text-muted-foreground',
                    'opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted',
                    isActive && 'opacity-100',
                  )}
                  onClick={(e) => { e.stopPropagation(); startEdit(doc) }}
                  title="Rename"
                  aria-label={`Rename ${doc.title}`}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}

              {docs.length > 1 && !isEditing && (
                <button
                  className={cn(
                    'shrink-0 rounded p-0.5 transition-colors text-muted-foreground',
                    'opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10',
                    isActive && 'opacity-100',
                  )}
                  onClick={(e) => { e.stopPropagation(); onDelete(doc.id) }}
                  title="Delete document"
                  aria-label={`Delete ${doc.title}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── InlineTitle ───────────────────────────────────────────────────────────────

interface InlineTitleProps {
  title: string
  onRename: (title: string) => void
}

function InlineTitle({ title, onRename }: InlineTitleProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setValue(title)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commit() {
    const trimmed = value.trim()
    if (trimmed) onRename(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="flex-1 min-w-0 bg-background border border-input rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      title="Click to rename"
      className="flex-1 min-w-0 flex items-center gap-1.5 group text-left px-1 rounded hover:bg-muted/60 transition-colors"
    >
      <span className="text-sm font-medium truncate text-foreground">{title}</span>
      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  )
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ getText, label }: { getText: () => string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* silent */ }
  }

  return (
    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCopy} title={label} aria-label={label}>
      {copied ? (
        <><Check className="h-3.5 w-3.5 text-green-500" /><span className="hidden sm:inline text-green-500">Copied!</span></>
      ) : (
        <><Copy className="h-3.5 w-3.5" /><span className="hidden sm:inline">Copy</span></>
      )}
    </Button>
  )
}

// ── ShortcutsDialog ───────────────────────────────────────────────────────────

/** Groups shortcuts by category for display. */
function ShortcutsDialog() {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof KEYBOARD_SHORTCUTS>()
    for (const s of KEYBOARD_SHORTCUTS) {
      const arr = map.get(s.category) ?? []
      arr.push(s)
      map.set(s.category, arr)
    }
    return map
  }, [])

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title="Keyboard shortcuts"
          aria-label="Show keyboard shortcuts"
        >
          <KeyboardIcon className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          {Array.from(grouped.entries()).map(([category, shortcuts]) => (
            <div key={category}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {category}
              </div>
              <div className="flex flex-col gap-1">
                {shortcuts.map((s) => (
                  <div key={s.keys} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-foreground">{s.description}</span>
                    <kbd className="shrink-0 text-[11px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-border whitespace-nowrap">
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── StatusBar ─────────────────────────────────────────────────────────────────

interface StatusBarProps {
  text: string
  model: VmeModel
  onModelChange: (m: VmeModel) => void
}

function StatusBar({ text, model, onModelChange }: StatusBarProps) {
  // Debounce the text used for counting to ~300ms so heavy counts don't run
  // on every keystroke.
  const deferredText = useDebouncedValue(text, 300)

  const tokens = useMemo(() => getTokenCount(deferredText, model), [deferredText, model])
  const approx  = isApprox(model)
  const words    = useMemo(() => countWords(deferredText),  [deferredText])
  const chars    = useMemo(() => countChars(deferredText),  [deferredText])
  const lines    = useMemo(() => countLines(deferredText),  [deferredText])

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 border-t border-border bg-muted/40 text-xs text-muted-foreground shrink-0">
      <ToggleGroup
        type="single"
        value={model}
        onValueChange={(v) => { if (v) onModelChange(v as VmeModel) }}
        className="gap-0.5"
      >
        {(Object.keys(MODEL_LABELS) as VmeModel[]).map((m) => (
          <ToggleGroupItem
            key={m}
            value={m}
            className="h-5 px-1.5 text-[10px] font-medium"
            title={MODEL_CONTEXT[m]}
          >
            {MODEL_LABELS[m]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Separator orientation="vertical" className="h-3 hidden sm:block" />

      <span className="font-mono tabular-nums">
        {approx && <span className="mr-0.5 opacity-60">~</span>}
        <span className="font-semibold text-foreground">{tokens.toLocaleString()}</span>
        {' '}tokens
      </span>
      <span className="hidden sm:inline font-mono tabular-nums">
        <span className="font-semibold text-foreground">{words.toLocaleString()}</span>
        {' '}words
      </span>
      <span className="hidden sm:inline font-mono tabular-nums">
        <span className="font-semibold text-foreground">{chars.toLocaleString()}</span>
        {' '}chars
      </span>
      <span className="hidden md:inline font-mono tabular-nums">
        <span className="font-semibold text-foreground">{lines.toLocaleString()}</span>
        {' '}lines
      </span>
    </div>
  )
}

// ── EmptyHint ─────────────────────────────────────────────────────────────────

/**
 * One-line muted hint shown only when the document is empty (and not dismissed).
 * Dismissal is stored in the VME store (hintDismissed: boolean).
 */
interface EmptyHintProps {
  content: string
  dismissed: boolean
  onDismiss: () => void
}

function EmptyHint({ content, dismissed, onDismiss }: EmptyHintProps) {
  if (dismissed || content.trim()) return null
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-1.5 border-b border-border bg-muted/30 text-xs text-muted-foreground">
      <span>
        Tip: select text for formatting, type{' '}
        <kbd className="font-mono bg-muted border border-border rounded px-0.5">/</kbd>
        {' '}for blocks, hover a table for row/column handles.
      </span>
      <button
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground transition-colors"
        title="Dismiss tip"
        aria-label="Dismiss tip"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── VisualMarkdownEditorPage ──────────────────────────────────────────────────

export default function VisualMarkdownEditorPage() {
  const {
    docs,
    activeDocId,
    selectedModel,
    editorMode,
    hintDismissed,
    createDoc,
    deleteDoc,
    updateDoc,
    setActiveDoc,
    setModel,
    saveVersion,
    setEditorMode,
    dismissHint,
  } = useVmeStore()

  const activeDoc = docs.find((d) => d.id === activeDocId) ?? docs[0]

  // mode is driven by store; keep a local alias for convenience
  const mode = editorMode
  const [docsOpen, setDocsOpen] = useState(true)
  const [mobileDocsOpen, setMobileDocsOpen] = useState(false)

  // Ref to WysiwygEditor's imperative handle for flushing before mode switch
  const wysiwygRef = useRef<WysiwygEditorHandle>(null)

  // Track previous non-preview mode for Ctrl+Shift+P toggle
  const prevNonPreviewMode = useRef<VmeEditorMode>(mode !== 'preview' ? mode : 'wysiwyg')

  // Media query for split mode direction (vertical on mobile, horizontal on desktop)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  // Inactivity auto-version timer
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)
    }
  }, [])

  // ── Content change handler ─────────────────────────────────────────────────

  function handleContentChange(content: string) {
    updateDoc(activeDoc.id, { content })
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)
    inactivityTimerRef.current = setTimeout(() => {
      saveVersion(activeDoc.id, { auto: true })
      inactivityTimerRef.current = null
    }, INACTIVITY_MS)
  }

  // ── Mode switch ────────────────────────────────────────────────────────────

  function handleModeChange(newMode: VmeEditorMode) {
    if (newMode === mode) return
    // Before leaving wysiwyg mode, flush any pending debounced onChange so
    // the store has the latest markdown before the editor unmounts.
    if (mode === 'wysiwyg') {
      wysiwygRef.current?.flush()
    }
    // Track last non-preview mode for Ctrl+Shift+P toggle
    if (mode !== 'preview') {
      prevNonPreviewMode.current = mode
    }
    // Clear the crash banner when leaving markdown mode (e.g. via toolbar)
    // so it doesn't linger in other modes.
    if (wysiwygError && newMode !== 'markdown') {
      setWysiwygError(false)
    }
    setEditorMode(newMode)
  }

  // ── Error boundary handler ─────────────────────────────────────────────────

  const [wysiwygError, setWysiwygError] = useState(false)

  function handleWysiwygError() {
    // Boundary already flushed; switch to markdown mode and show the banner
    setEditorMode('markdown')
    setWysiwygError(true)
  }

  function handleWysiwygRetry() {
    // Clear error banner and re-enter wysiwyg — a fresh boundary mounts
    setWysiwygError(false)
    setEditorMode('wysiwyg')
  }

  // ── Doc switch ─────────────────────────────────────────────────────────────

  const switchDoc = useCallback(
    (newId: string) => {
      if (newId === activeDocId) return
      // Flush wysiwyg before switching
      if (mode === 'wysiwyg') {
        wysiwygRef.current?.flush()
      }
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }
      saveVersion(activeDocId, { auto: true })
      setActiveDoc(newId)
      setMobileDocsOpen(false)
    },
    [activeDocId, mode, setActiveDoc, saveVersion],
  )

  // ── Download ───────────────────────────────────────────────────────────────

  function handleDownload() {
    const blob = new Blob([activeDoc.content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${toSafeFilename(activeDoc.title) || 'document'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Ctrl+Shift+P / Cmd+Shift+P — toggle preview ────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const modKey = e.ctrlKey || e.metaKey
      if (modKey && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        if (mode === 'preview') {
          // Return to previous editing mode
          handleModeChange(prevNonPreviewMode.current)
        } else {
          prevNonPreviewMode.current = mode
          handleModeChange('preview')
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // ── Mode icons ─────────────────────────────────────────────────────────────

  const modeIcons: Record<VmeEditorMode, React.ReactNode> = {
    wysiwyg:  <Layers   className="h-3.5 w-3.5" />,
    markdown: <Code2    className="h-3.5 w-3.5" />,
    preview:  <Eye      className="h-3.5 w-3.5" />,
    split:    <Columns2 className="h-3.5 w-3.5" />,
  }

  const modeLabels: Record<VmeEditorMode, string> = {
    wysiwyg:  'Visual',
    markdown: 'Markdown',
    preview:  'Preview',
    split:    'Split',
  }

  const modeTitles: Record<VmeEditorMode, string> = {
    wysiwyg:  'Visual editor',
    markdown: 'Markdown source',
    preview:  'Preview',
    split:    'Split view (markdown | preview)',
  }

  // ── Top toolbar (mode switcher + doc actions) ──────────────────────────────

  const topToolbar = (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-card shrink-0 min-w-0">
      {/* Mobile: doc list trigger */}
      <Sheet open={mobileDocsOpen} onOpenChange={setMobileDocsOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 md:hidden shrink-0"
            aria-label="Open documents"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-64 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Documents</SheetTitle>
          </SheetHeader>
          <DocSidePanel
            docs={docs}
            activeDocId={activeDocId}
            onSelect={switchDoc}
            onNew={() => { createDoc(); setMobileDocsOpen(false) }}
            onDelete={deleteDoc}
            onRename={(id, title) => updateDoc(id, { title })}
          />
        </SheetContent>
      </Sheet>

      {/* Inline title */}
      <InlineTitle
        title={activeDoc.title}
        onRename={(title) => updateDoc(activeDoc.id, { title })}
      />

      {/* Mode switcher */}
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(v) => { if (v) handleModeChange(v as VmeEditorMode) }}
        className="gap-0 shrink-0"
      >
        {(['wysiwyg', 'markdown', 'preview', 'split'] as VmeEditorMode[]).map((m) => (
          <ToggleGroupItem
            key={m}
            value={m}
            className="h-7 px-2 text-[11px] font-medium gap-1"
            title={modeTitles[m]}
          >
            {modeIcons[m]}
            <span className="hidden sm:inline">{modeLabels[m]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Separator orientation="vertical" className="h-5 mx-0.5 hidden sm:block" />

      {/* Copy + Download + Shortcuts */}
      <CopyButton getText={() => activeDoc.content} label="Copy markdown" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs shrink-0"
        onClick={handleDownload}
        title="Download as .md"
        aria-label="Download as .md"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">.md</span>
      </Button>
      <ShortcutsDialog />
    </div>
  )

  // ── Editor area (conditional rendering — only active mode is mounted) ───────

  const wysiwygPanel = (
    <div className="h-full overflow-y-auto">
      <WysiwygEditor
        ref={wysiwygRef}
        value={activeDoc.content}
        onChange={handleContentChange}
        placeholder="Start writing… (type / for commands)"
        className="h-full"
        onChangeDebounceMs={150}
        toolbar={true}
      />
    </div>
  )

  const editorArea = (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      {/* Crash banner — compact strip above the editor; shown after a wysiwyg
          render crash, dismissed when user retries visual mode. */}
      {wysiwygError && (
        <div
          role="alert"
          className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-destructive/30 bg-destructive/10 text-sm text-foreground"
        >
          <span>
            The visual editor hit a problem and switched to Markdown mode.
            Your content is safe.
          </span>
          <button
            className="shrink-0 rounded-md border border-border bg-background px-3 py-1 text-xs hover:bg-muted transition-colors whitespace-nowrap"
            onClick={handleWysiwygRetry}
          >
            Try visual mode again
          </button>
        </div>
      )}

      {/* Empty-doc first-run hint — only shown in wysiwyg mode */}
      {mode === 'wysiwyg' && (
        <EmptyHint
          content={activeDoc.content}
          dismissed={hintDismissed}
          onDismiss={dismissHint}
        />
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        {/* Wysiwyg panel — boundary wraps ONLY this panel so on crash the
            mode switches to markdown and the CodeEditor below becomes visible. */}
        {mode === 'wysiwyg' && (
          <WysiwygErrorBoundary
            flushRef={wysiwygRef as RefObject<WysiwygEditorHandle | null>}
            onError={handleWysiwygError}
          >
            {wysiwygPanel}
          </WysiwygErrorBoundary>
        )}

        {mode === 'markdown' && (
          <div className="h-full overflow-hidden">
            <CodeEditor
              value={activeDoc.content}
              onChange={handleContentChange}
              language="markdown"
              height="100%"
              className="h-full"
              placeholder="Write markdown here…"
              basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: true, history: true }}
            />
          </div>
        )}

        {mode === 'preview' && (
          <div className="h-full overflow-y-auto px-5 py-4">
            <MarkdownRenderer content={activeDoc.content} />
          </div>
        )}

        {mode === 'split' && (
          <ResizablePanelGroup
            orientation={isDesktop ? 'horizontal' : 'vertical'}
            className="h-full"
          >
            <ResizablePanel defaultSize={50} minSize={25}>
              <div className="h-full overflow-hidden">
                <CodeEditor
                  value={activeDoc.content}
                  onChange={handleContentChange}
                  language="markdown"
                  height="100%"
                  className="h-full"
                  placeholder="Write markdown here…"
                  basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: true, history: true }}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={25}>
              <div className="h-full overflow-y-auto px-5 py-4">
                <MarkdownRenderer content={activeDoc.content} />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </div>
  )

  // ── Full layout ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Desktop layout (md+) ── */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">

        {/* CENTER: top toolbar + editor */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {topToolbar}
          {editorArea}
          <StatusBar
            text={activeDoc.content}
            model={selectedModel}
            onModelChange={setModel}
          />
        </div>

        {/* RIGHT: collapsible document list */}
        <Collapsible
          open={docsOpen}
          onOpenChange={setDocsOpen}
          className="flex shrink-0"
        >
          {/* Collapse/expand toggle */}
          <CollapsibleTrigger asChild>
            <button
              className="shrink-0 flex items-center justify-center w-5 border-l border-border bg-muted/30 hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
              title={docsOpen ? 'Hide documents' : 'Show documents'}
              aria-label={docsOpen ? 'Hide document list' : 'Show document list'}
            >
              {docsOpen ? (
                <ChevronRight className="h-3 w-3" />
              ) : (
                <ChevronLeft className="h-3 w-3" />
              )}
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent
            className={cn(
              'overflow-hidden border-l border-border bg-card flex flex-col',
              docsOpen ? 'w-44 lg:w-52' : 'w-0',
            )}
          >
            <DocSidePanel
              docs={docs}
              activeDocId={activeDocId}
              onSelect={switchDoc}
              onNew={createDoc}
              onDelete={deleteDoc}
              onRename={(id, title) => updateDoc(id, { title })}
            />
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* ── Mobile layout (<md) ── */}
      <div className="flex md:hidden flex-col flex-1 min-h-0 overflow-hidden">
        {topToolbar}
        {editorArea}
        <StatusBar
          text={activeDoc.content}
          model={selectedModel}
          onModelChange={setModel}
        />
      </div>

    </div>
  )
}
