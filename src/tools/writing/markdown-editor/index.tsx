import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useDeferredValue,
} from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown as markdownLang } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode'
import {
  PanelLeft,
  Plus,
  Trash2,
  Copy,
  Check,
  FileText,
  Download,
  Pencil,
  History,
  RotateCcw,
  Pin,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import MarkdownRenderer from '@/components/editor/MarkdownRenderer'
import {
  countTokensGpt,
  countTokensApprox,
  countWords,
  countChars,
  countLines,
  formatVersionTime,
} from './logic'
import { useMarkdownEditorStore, type Doc, type Model, type Version } from './store'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Inactivity threshold (ms) before an auto-version is captured. */
const INACTIVITY_MS = 5 * 60 * 1000 // 5 minutes

// ── Editor theme (local) ──────────────────────────────────────────────────────
// Kept here (not in shared CodeEditor) because the markdown editor manages its
// own EditorState per-document for undo history, and needs to reconstruct the
// extensions when creating a fresh EditorState on first visit to a doc.
function makeEditorTheme(dark: boolean): Extension[] {
  const base = dark ? vscodeDark : vscodeLight
  const baseExts = Array.isArray(base) ? base : [base]
  return [
    ...baseExts,
    EditorView.theme({
      '&':                    { backgroundColor: 'transparent !important', height: '100%' },
      '.cm-content':          { color: dark ? '#9ca3af' : '#374151' },
      '.cm-scroller':         { backgroundColor: 'transparent !important', overflow: 'auto' },
      '.cm-gutters':          {
        backgroundColor: 'transparent !important',
        borderRight: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
      },
      '.cm-activeLineGutter': { backgroundColor: 'rgba(128,128,128,0.08) !important' },
      '.cm-activeLine':       { backgroundColor: 'rgba(128,128,128,0.08) !important' },
    }),
  ]
}

// ── Token counting ────────────────────────────────────────────────────────────

function getTokenCount(text: string, model: Model): number {
  if (model === 'gpt4o') return countTokensGpt(text)
  return countTokensApprox(text)
}

function isApprox(model: Model): boolean {
  return model !== 'gpt4o'
}

const MODEL_LABELS: Record<Model, string> = {
  gpt4o: 'GPT-4o',
  claude: 'Claude',
  gemini: 'Gemini',
}

const MODEL_CONTEXT: Record<Model, string> = {
  gpt4o: '128K ctx',
  claude: '200K ctx',
  gemini: '1M ctx',
}

// ── DocSidebar ────────────────────────────────────────────────────────────────

interface DocSidebarProps {
  docs: Doc[]
  activeDocId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  /** When true, renders inside a Sheet (mobile) — hides the outer border. */
  inSheet?: boolean
}

function DocSidebar({
  docs,
  activeDocId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  inSheet = false,
}: DocSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit(doc: Doc) {
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
    <div
      className={cn(
        'flex flex-col h-full bg-card',
        !inSheet && 'border-r border-border',
      )}
    >
      {/* Sidebar header */}
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
          const isActive = doc.id === activeDocId
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

              {/* Rename button — visible on hover / active */}
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

              {/* Delete — only show if more than 1 doc */}
              {docs.length > 1 && !isEditing && (
                <button
                  className={cn(
                    'shrink-0 rounded p-0.5 transition-colors text-muted-foreground',
                    'opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10',
                    isActive && 'opacity-100',
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(doc.id)
                  }}
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

// ── StatusBar ─────────────────────────────────────────────────────────────────

interface StatusBarProps {
  text: string
  model: Model
  onModelChange: (m: Model) => void
}

function StatusBar({ text, model, onModelChange }: StatusBarProps) {
  // Defer token count so fast typing never lags
  const deferredText = useDeferredValue(text)
  const tokens = getTokenCount(deferredText, model)
  const approx = isApprox(model)
  const words = countWords(deferredText)
  const chars = countChars(deferredText)
  const lines = countLines(deferredText)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 border-t border-border bg-muted/40 text-xs text-muted-foreground shrink-0">
      {/* Model toggle */}
      <ToggleGroup
        type="single"
        value={model}
        onValueChange={(v) => { if (v) onModelChange(v as Model) }}
        className="gap-0.5"
      >
        {(Object.keys(MODEL_LABELS) as Model[]).map((m) => (
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

      {/* Counts */}
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
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={handleCopy}
      title={label}
      aria-label={label}
    >
      {copied ? (
        <><Check className="h-3.5 w-3.5 text-green-500" /><span className="hidden sm:inline text-green-500">Copied!</span></>
      ) : (
        <><Copy className="h-3.5 w-3.5" /><span className="hidden sm:inline">Copy</span></>
      )}
    </Button>
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
    setTimeout(() => { inputRef.current?.select() }, 0)
  }

  function commit() {
    const trimmed = value.trim()
    if (trimmed) onRename(trimmed)
    setEditing(false)
  }

  // Keep value in sync if title changes externally (e.g. doc switch)
  useEffect(() => {
    if (!editing) setValue(title)
  }, [title, editing])

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

// ── VersionItem ───────────────────────────────────────────────────────────────

interface VersionItemProps {
  version: Version
  onRestore: () => void
  onPin: (label: string) => void
  onDelete: () => void
}

function VersionItem({ version, onRestore, onPin, onDelete }: VersionItemProps) {
  const [pinning, setPinning] = useState(false)
  const [pinLabel, setPinLabel] = useState(version.label ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const timeLabel = formatVersionTime(version.savedAt)
  const words = countWords(version.content)

  function startPin() {
    setPinLabel(version.label ?? '')
    setPinning(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function commitPin() {
    const trimmed = pinLabel.trim()
    onPin(trimmed || (version.label ?? 'Pinned version'))
    setPinning(false)
  }

  return (
    <div className="group flex flex-col gap-1 px-3 py-2.5 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
      {/* Top row: timestamp + badges */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="flex-1 min-w-0 text-xs font-medium text-foreground truncate" title={timeLabel}>
          {version.label ?? timeLabel}
        </span>
        {version.label && (
          <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
            Pinned
          </span>
        )}
        {version.auto && !version.label && (
          <span className="shrink-0 text-[10px] text-muted-foreground/60">Auto</span>
        )}
      </div>

      {/* Sub-row: word count + relative time when label shown */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
        {version.label && (
          <>
            <span>·</span>
            <span>{timeLabel}</span>
          </>
        )}
      </div>

      {/* Pin label input */}
      {pinning && (
        <input
          ref={inputRef}
          value={pinLabel}
          onChange={(e) => setPinLabel(e.target.value)}
          onBlur={commitPin}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitPin()
            if (e.key === 'Escape') setPinning(false)
          }}
          placeholder="Name this version…"
          className="mt-0.5 w-full bg-background border border-input rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}

      {/* Actions — visible on hover */}
      {!pinning && (
        <div className="flex items-center gap-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onRestore}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted"
            title="Restore this version"
          >
            <RotateCcw className="h-3 w-3" />
            Restore
          </button>
          <button
            onClick={startPin}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted"
            title={version.label ? 'Rename pin' : 'Pin this version'}
          >
            <Pin className="h-3 w-3" />
            {version.label ? 'Rename' : 'Pin'}
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors rounded px-1.5 py-0.5 hover:bg-destructive/10 ml-auto"
            title="Delete this version"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}

// ── HistoryDrawer ─────────────────────────────────────────────────────────────

interface HistoryDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  doc: Doc
  onSaveVersion: () => void
  onRestore: (versionId: string) => void
  onPin: (versionId: string, label: string) => void
  onDelete: (versionId: string) => void
}

function HistoryDrawer({
  open,
  onOpenChange,
  doc,
  onSaveVersion,
  onRestore,
  onPin,
  onDelete,
}: HistoryDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-72 sm:max-w-xs p-0 flex flex-col gap-0"
        showCloseButton={false}
      >
        {/* Header */}
        <SheetHeader className="flex flex-row items-center justify-between px-4 py-3 border-b border-border shrink-0 gap-0">
          <SheetTitle className="text-sm font-semibold">Version History</SheetTitle>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={onSaveVersion}
              title="Save a version now"
            >
              <History className="h-3.5 w-3.5" />
              Save now
            </Button>
            <SheetClose asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7">
                <X className="h-3.5 w-3.5" />
                <span className="sr-only">Close</span>
              </Button>
            </SheetClose>
          </div>
        </SheetHeader>

        {/* Version list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {doc.versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 h-40 text-center px-6">
              <History className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No versions yet</p>
              <p className="text-xs text-muted-foreground/60">
                Versions are saved automatically every 5 minutes of inactivity, when you switch
                documents, or when you click "Save now".
              </p>
            </div>
          ) : (
            doc.versions.map((v) => (
              <VersionItem
                key={v.id}
                version={v}
                onRestore={() => onRestore(v.id)}
                onPin={(label) => onPin(v.id, label)}
                onDelete={() => onDelete(v.id)}
              />
            ))
          )}
        </div>

        {/* Footer — version count */}
        {doc.versions.length > 0 && (
          <div className="px-4 py-2 border-t border-border shrink-0">
            <p className="text-[11px] text-muted-foreground/60 text-center">
              {doc.versions.filter((v) => !v.auto).length} pinned
              {' · '}
              {doc.versions.filter((v) => v.auto).length} auto
              {' · '}
              {doc.versions.length} total
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── MarkdownEditorPage ────────────────────────────────────────────────────────

export default function MarkdownEditorPage() {
  const {
    docs,
    activeDocId,
    selectedModel,
    createDoc,
    deleteDoc,
    updateDoc,
    setActiveDoc,
    setModel,
    saveVersion,
    restoreVersion,
    deleteVersion,
    pinVersion,
  } = useMarkdownEditorStore()

  const activeDoc = docs.find((d) => d.id === activeDocId) ?? docs[0]

  // Per-document EditorState map — preserves undo history on doc switch
  const stateMapRef = useRef<Map<string, EditorState>>(new Map())
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Inactivity timer ref — fires auto-version after INACTIVITY_MS of no typing
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track theme changes so CodeMirror re-builds extensions when .dark toggles
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')))
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  // Recompute extensions when theme flips — stored so EditorState restores use same set
  const extensionsRef = useRef<Extension[]>([markdownLang(), ...makeEditorTheme(dark)])
  useEffect(() => {
    extensionsRef.current = [markdownLang(), ...makeEditorTheme(dark)]
  }, [dark])

  // Cleanup inactivity timer on unmount
  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)
    }
  }, [])

  // When switching docs: auto-version current doc (if content changed) then restore target state
  const switchDoc = useCallback(
    (newId: string) => {
      if (newId === activeDocId) return

      // Cancel any pending inactivity snapshot for the outgoing doc
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }

      // Auto-snapshot outgoing doc on switch (saveVersion skips duplicates internally)
      saveVersion(activeDocId, { auto: true })

      // Save current editor state (preserves undo history)
      const view = editorRef.current?.view
      if (view) {
        stateMapRef.current.set(activeDocId, view.state)
      }

      setActiveDoc(newId)
    },
    [activeDocId, setActiveDoc, saveVersion],
  )

  // After activeDocId changes, restore the saved state into the view
  useEffect(() => {
    const view = editorRef.current?.view
    if (!view) return

    const doc = docs.find((d) => d.id === activeDocId)
    if (!doc) return

    const saved = stateMapRef.current.get(activeDocId)
    if (saved) {
      // Restore the previously saved EditorState (preserves full undo history)
      view.setState(saved)
    } else {
      // First visit — create a fresh EditorState from stored content
      const freshState = EditorState.create({
        doc: doc.content,
        extensions: extensionsRef.current,
      })
      view.setState(freshState)
    }
  }, [activeDocId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleDocChange(id: string) {
    switchDoc(id)
    setSheetOpen(false)
  }

  function handleEditorChange(value: string) {
    updateDoc(activeDoc.id, { content: value })

    // Reset inactivity timer — fires auto-version after INACTIVITY_MS of no typing
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)
    inactivityTimerRef.current = setTimeout(() => {
      saveVersion(activeDoc.id, { auto: true })
      inactivityTimerRef.current = null
    }, INACTIVITY_MS)
  }

  function handleDownload() {
    const blob = new Blob([activeDoc.content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeDoc.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  /**
   * Restore a version: snapshot current state, apply version content, and
   * clear the EditorState entry so the existing useEffect re-creates a fresh
   * EditorState from doc.content — wiping the undo stack cleanly (Option A).
   */
  function handleRestoreVersion(versionId: string) {
    restoreVersion(activeDoc.id, versionId)
    // Clear the cached EditorState so the useEffect below creates a fresh one
    // from the restored content, giving a clean undo stack
    stateMapRef.current.delete(activeDoc.id)
    // Trigger the restore into the CodeMirror view by faking an activeDocId change effect
    const view = editorRef.current?.view
    if (view) {
      // Get the freshly restored content from store (restoreVersion is synchronous)
      const updatedDoc = useMarkdownEditorStore.getState().docs.find(
        (d) => d.id === activeDoc.id,
      )
      if (updatedDoc) {
        const freshState = EditorState.create({
          doc: updatedDoc.content,
          extensions: extensionsRef.current,
        })
        view.setState(freshState)
      }
    }
    setHistoryOpen(false)
  }

  function handleManualSaveVersion() {
    saveVersion(activeDoc.id, { auto: false })
  }

  // ── Toolbar ───────────────────────────────────────────────────────

  const toolbar = (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-card shrink-0">
      {/* Mobile: hamburger */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 md:hidden"
            aria-label="Open documents"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Documents</SheetTitle>
          </SheetHeader>
          <DocSidebar
            docs={docs}
            activeDocId={activeDocId}
            onSelect={handleDocChange}
            onNew={() => { createDoc(); setSheetOpen(false) }}
            onDelete={deleteDoc}
            onRename={(id, title) => updateDoc(id, { title })}
            inSheet
          />
        </SheetContent>
      </Sheet>

      {/* Active doc title — click to rename */}
      <InlineTitle
        title={activeDoc.title}
        onRename={(title) => updateDoc(activeDoc.id, { title })}
      />

      {/* Actions */}
      <CopyButton getText={() => activeDoc.content} label="Copy markdown" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={handleDownload}
        title="Download as .md"
        aria-label="Download as .md"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">.md</span>
      </Button>

      {/* History button */}
      <Button
        variant="ghost"
        size="icon"
        className={cn('h-7 w-7', historyOpen && 'bg-muted')}
        onClick={() => setHistoryOpen(true)}
        title="Version history"
        aria-label="Version history"
      >
        <History className="h-3.5 w-3.5" />
      </Button>
    </div>
  )

  // ── Editor pane ───────────────────────────────────────────────────
  // Uses raw CodeMirror (not the shared <CodeEditor>) so we can attach
  // editorRef for per-document undo-state management.

  const editorPane = (
    <CodeMirror
      ref={editorRef}
      value={activeDoc.content}
      extensions={[markdownLang(), ...makeEditorTheme(dark)]}
      theme="none"
      onChange={handleEditorChange}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: true,
        history: true,
      }}
      className="h-full overflow-auto text-sm [&_.cm-editor]:h-full [&_.cm-scroller]:font-mono [&_.cm-scroller]:leading-relaxed"
      height="100%"
    />
  )

  // ── Preview pane ──────────────────────────────────────────────────

  const previewPane = (
    <div className="h-full overflow-y-auto px-5 py-4">
      <MarkdownRenderer content={activeDoc.content} />
    </div>
  )

  // ── Full layout ───────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Desktop layout (md+): sidebar + split panes ── */}
      <div className="hidden md:flex flex-1 min-h-0">

        {/* Sidebar */}
        <div className="w-48 lg:w-56 shrink-0 flex flex-col min-h-0">
          <DocSidebar
            docs={docs}
            activeDocId={activeDocId}
            onSelect={switchDoc}
            onNew={createDoc}
            onDelete={deleteDoc}
            onRename={(id, title) => updateDoc(id, { title })}
          />
        </div>

        {/* Editor + Preview split */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {toolbar}

          <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
            {/* Editor */}
            <ResizablePanel defaultSize="50" minSize="15" className="min-w-0 min-h-0 overflow-hidden">
              {editorPane}
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Preview */}
            <ResizablePanel defaultSize="50" minSize="15" className="min-w-0 min-h-0 overflow-hidden bg-background">
              {previewPane}
            </ResizablePanel>
          </ResizablePanelGroup>

          <StatusBar
            text={activeDoc.content}
            model={selectedModel}
            onModelChange={setModel}
          />
        </div>
      </div>

      {/* ── Mobile layout (<md): toolbar + tabs ── */}
      <div className="flex md:hidden flex-col flex-1 min-h-0">
        {toolbar}

        {/* Edit / Preview tabs */}
        <Tabs
          value={mobileTab}
          onValueChange={(v) => setMobileTab(v as 'edit' | 'preview')}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="shrink-0 w-full rounded-none border-b border-border bg-muted/40 h-9">
            <TabsTrigger value="edit" className="flex-1 text-xs h-7">Edit</TabsTrigger>
            <TabsTrigger value="preview" className="flex-1 text-xs h-7">Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="flex-1 min-h-0 mt-0 overflow-hidden">
            {editorPane}
          </TabsContent>

          <TabsContent value="preview" className="flex-1 min-h-0 mt-0 overflow-hidden">
            {previewPane}
          </TabsContent>
        </Tabs>

        <StatusBar
          text={activeDoc.content}
          model={selectedModel}
          onModelChange={setModel}
        />
      </div>

      {/* ── History drawer (shared, works on mobile + desktop) ── */}
      <HistoryDrawer
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        doc={activeDoc}
        onSaveVersion={handleManualSaveVersion}
        onRestore={handleRestoreVersion}
        onPin={(versionId, label) => pinVersion(activeDoc.id, versionId, label)}
        onDelete={(versionId) => deleteVersion(activeDoc.id, versionId)}
      />
    </div>
  )
}
