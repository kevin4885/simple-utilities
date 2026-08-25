/**
 * Visual Markdown Editor — WYSIWYG editor tool page
 *
 * Layout:
 *   Desktop (md+):
 *     [Left: collapsible palette] [Center: mode switcher + editor area] [Right: collapsible doc list]
 *   Mobile (<md):
 *     Toolbar (mode switcher + actions) + editor area stacked, docs in Sheet
 *
 * Three editing modes via ToggleGroup:
 *   Visual    → WysiwygEditor (TipTap)
 *   Markdown  → CodeEditor (CodeMirror, language="markdown")
 *   Preview   → MarkdownRenderer
 *
 * All three modes share the same markdown string from the store.
 * Switching modes never loses content.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useDeferredValue,
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
import { Separator } from '@/components/ui/separator'
import WysiwygEditor from '@/components/editor/WysiwygEditor'
import CodeEditor from '@/components/editor/CodeEditor'
import MarkdownRenderer from '@/components/editor/MarkdownRenderer'
import {
  countTokensGpt,
  countTokensApprox,
  countWords,
  countChars,
  countLines,
  toSafeFilename,
  PALETTE_GROUPS,
} from './logic'
import { useVmeStore, type VmeDoc, type VmeModel } from './store'

// ── Constants ─────────────────────────────────────────────────────────────────

const INACTIVITY_MS = 5 * 60 * 1000

type EditorMode = 'wysiwyg' | 'markdown' | 'preview'

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

// ── ComponentPalette ──────────────────────────────────────────────────────────

interface ComponentPaletteProps {
  /** Inserts a markdown snippet at the cursor (or appends to WYSIWYG editor) */
  onInsert: (snippet: string) => void
  /** True when the WYSIWYG editor is not the active mode */
  disabled?: boolean
}

function ComponentPalette({ onInsert, disabled }: ComponentPaletteProps) {
  return (
    <div className={cn('flex flex-col gap-0 overflow-y-auto min-h-0', disabled && 'opacity-40 pointer-events-none')}>
      {PALETTE_GROUPS.map((group) => (
        <div key={group.group} className="border-b border-border last:border-0">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
            {group.group}
          </div>
          <div className="py-0.5">
            {group.items.map((item) => (
              <button
                key={item.label}
                title={item.description}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent/60 hover:text-accent-foreground"
                onClick={() => onInsert(item.snippet)}
              >
                <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-muted text-[10px] font-mono font-bold text-muted-foreground">
                  {item.icon}
                </span>
                <span className="min-w-0 flex flex-col">
                  <span className="truncate font-medium">{item.label}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
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
    // Always refresh value from current title prop when entering edit mode
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

// ── StatusBar ─────────────────────────────────────────────────────────────────

interface StatusBarProps {
  text: string
  model: VmeModel
  onModelChange: (m: VmeModel) => void
}

function StatusBar({ text, model, onModelChange }: StatusBarProps) {
  const deferredText = useDeferredValue(text)
  const tokens = getTokenCount(deferredText, model)
  const approx  = isApprox(model)
  const words    = countWords(deferredText)
  const chars    = countChars(deferredText)
  const lines    = countLines(deferredText)

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

// ── VisualMarkdownEditorPage ──────────────────────────────────────────────────

export default function VisualMarkdownEditorPage() {
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
  } = useVmeStore()

  const activeDoc = docs.find((d) => d.id === activeDocId) ?? docs[0]

  const [mode, setMode] = useState<EditorMode>('wysiwyg')
  const [paletteOpen, setPaletteOpen] = useState(true)
  const [docsOpen, setDocsOpen] = useState(true)
  const [mobileDocsOpen, setMobileDocsOpen] = useState(false)

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

  // ── Doc switch ─────────────────────────────────────────────────────────────

  const switchDoc = useCallback(
    (newId: string) => {
      if (newId === activeDocId) return
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }
      saveVersion(activeDocId, { auto: true })
      setActiveDoc(newId)
      setMobileDocsOpen(false)
    },
    [activeDocId, setActiveDoc, saveVersion],
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

  // ── Palette insert ─────────────────────────────────────────────────────────
  // In WYSIWYG mode the WysiwygEditor accepts value/onChange, so we inject
  // the snippet by appending to the markdown string then letting tiptap-markdown
  // re-parse. This is simpler than imperative editor.commands.insertContent()
  // and works correctly for all snippet types.

  function handlePaletteInsert(snippet: string) {
    if (mode !== 'wysiwyg') return
    const current = activeDoc.content
    // Add newline separator if content doesn't end with newline
    const separator = current && !current.endsWith('\n') ? '\n' : ''
    handleContentChange(current + separator + snippet)
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────

  const modeIcons: Record<EditorMode, React.ReactNode> = {
    wysiwyg:  <Layers  className="h-3.5 w-3.5" />,
    markdown: <Code2   className="h-3.5 w-3.5" />,
    preview:  <Eye     className="h-3.5 w-3.5" />,
  }

  const toolbar = (
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
        onValueChange={(v) => { if (v) setMode(v as EditorMode) }}
        className="gap-0 shrink-0"
      >
        {(['wysiwyg', 'markdown', 'preview'] as EditorMode[]).map((m) => (
          <ToggleGroupItem
            key={m}
            value={m}
            className="h-7 px-2 text-[11px] font-medium gap-1"
            title={m === 'wysiwyg' ? 'Visual editor' : m === 'markdown' ? 'Markdown source' : 'Preview'}
          >
            {modeIcons[m]}
            <span className="hidden sm:inline capitalize">{m === 'wysiwyg' ? 'Visual' : m === 'markdown' ? 'Markdown' : 'Preview'}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Separator orientation="vertical" className="h-5 mx-0.5 hidden sm:block" />

      {/* Copy + Download */}
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
    </div>
  )

  // ── Editor area ────────────────────────────────────────────────────────────

  const editorArea = (
    <div className="flex-1 min-h-0 overflow-hidden">
      {/* WYSIWYG mode */}
      <div className={cn('h-full overflow-y-auto', mode !== 'wysiwyg' && 'hidden')}>
        <WysiwygEditor
          value={activeDoc.content}
          onChange={handleContentChange}
          placeholder="Start writing… (type / for commands)"
          className="h-full"
        />
      </div>

      {/* Markdown mode */}
      <div className={cn('h-full overflow-hidden', mode !== 'markdown' && 'hidden')}>
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

      {/* Preview mode */}
      <div className={cn('h-full overflow-y-auto px-5 py-4', mode !== 'preview' && 'hidden')}>
        <MarkdownRenderer content={activeDoc.content} />
      </div>
    </div>
  )

  // ── Full layout ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Desktop layout (md+) ── */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT: collapsible component palette */}
        <Collapsible
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          className="flex shrink-0"
        >
          <CollapsibleContent
            className={cn(
              'overflow-hidden border-r border-border bg-card flex flex-col',
              paletteOpen ? 'w-44 lg:w-52' : 'w-0',
            )}
          >
            {/* Palette header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Components
              </span>
            </div>
            <ComponentPalette
              onInsert={handlePaletteInsert}
              disabled={mode !== 'wysiwyg'}
            />
          </CollapsibleContent>

          {/* Collapse/expand toggle */}
          <CollapsibleTrigger asChild>
            <button
              className="shrink-0 flex items-center justify-center w-5 border-r border-border bg-muted/30 hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
              title={paletteOpen ? 'Hide palette' : 'Show palette'}
              aria-label={paletteOpen ? 'Hide component palette' : 'Show component palette'}
            >
              {paletteOpen ? (
                <ChevronLeft className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          </CollapsibleTrigger>
        </Collapsible>

        {/* CENTER: toolbar + editor */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {toolbar}
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
        {toolbar}
        {editorArea}
        <StatusBar
          text={activeDoc.content}
          model={selectedModel}
          onModelChange={setModel}
        />
      </div>

      {/* Panel toggle buttons for desktop — accessible via button in toolbar */}
      {/* Palette and docs panel triggers are built into the Collapsible above */}

    </div>
  )
}
