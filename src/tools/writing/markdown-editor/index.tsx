import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useDeferredValue,
  useMemo,
} from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown as markdownLang } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
// Register only the languages we care about (keeps bundle lean)
import langBash       from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import langCss        from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import langHtml       from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import langJson       from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import langJs         from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import langJsx        from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import langMarkdown   from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import langPython     from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import langSql        from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import langTs         from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import langTsx        from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import langYaml       from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'

SyntaxHighlighter.registerLanguage('bash',       langBash)
SyntaxHighlighter.registerLanguage('shell',      langBash)
SyntaxHighlighter.registerLanguage('sh',         langBash)
SyntaxHighlighter.registerLanguage('css',        langCss)
SyntaxHighlighter.registerLanguage('html',       langHtml)
SyntaxHighlighter.registerLanguage('json',       langJson)
SyntaxHighlighter.registerLanguage('javascript', langJs)
SyntaxHighlighter.registerLanguage('jsx',        langJsx)
SyntaxHighlighter.registerLanguage('markdown',   langMarkdown)
SyntaxHighlighter.registerLanguage('python',     langPython)
SyntaxHighlighter.registerLanguage('sql',        langSql)
SyntaxHighlighter.registerLanguage('typescript', langTs)
SyntaxHighlighter.registerLanguage('tsx',        langTsx)
SyntaxHighlighter.registerLanguage('yaml',       langYaml)
import {
  PanelLeft,
  Plus,
  Trash2,
  Copy,
  Check,
  FileText,
  Download,
  Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import {
  countTokensGpt,
  countTokensApprox,
  countWords,
  countChars,
  countLines,
} from './logic'
import { useMarkdownEditorStore, type Doc, type Model } from './store'

// ── CodeMirror theme ──────────────────────────────────────────────────────────
// Use vscodeDark / vscodeLight for proper syntax highlighting, then strip the
// hardcoded background so the editor inherits the card surface beneath it.
const makeEditorTheme = (dark: boolean): Extension[] => {
  const base = dark ? vscodeDark : vscodeLight
  const baseExts = Array.isArray(base) ? base : [base]
  return [
    ...baseExts,
    EditorView.theme({
      '&':                   { backgroundColor: 'transparent !important', height: '100%' },
      '.cm-content':         { color: dark ? '#9ca3af' : '#374151' },
      '.cm-scroller':        { backgroundColor: 'transparent !important', overflow: 'auto' },
      '.cm-gutters':         {
        backgroundColor: 'transparent !important',
        borderRight: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
      },
      '.cm-activeLineGutter':{ backgroundColor: 'rgba(128,128,128,0.08) !important' },
      '.cm-activeLine':      { backgroundColor: 'rgba(128,128,128,0.08) !important' },
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

// ── MarkdownPreview ───────────────────────────────────────────────────────────
// Stable MD_COMPONENTS at module level — prevents react-markdown re-parsing on
// every parent render. Dark prop is passed in so code blocks match the app theme.

const SUPPORTED_LANGUAGES = [
  'bash', 'shell', 'sh', 'css', 'html', 'json',
  'javascript', 'jsx', 'markdown', 'python',
  'sql', 'typescript', 'tsx', 'yaml',
]

function makeMdComponents(dark: boolean, onCopy: (text: string) => void) {
  return {
    // Strip react-markdown's outer <pre> so code blocks are never double-wrapped
    pre({ children }: { children?: React.ReactNode }) {
      return <>{children}</>
    },

    // Links open in new tab
    a({ node: _n, href, children, ...props }: React.ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
      return <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline" {...props}>{children}</a>
    },

    // All three code cases
    code({ className, children, node: _n, ...props }: React.ComponentPropsWithoutRef<'code'> & { node?: unknown }) {
      const match        = /language-(\w+)/.exec(className ?? '')
      const detectedLang = match ? match[1] : ''

      // Case 1: labeled fenced block — syntax highlighted
      if (detectedLang) {
        const language = SUPPORTED_LANGUAGES.includes(detectedLang) ? detectedLang : 'javascript'
        const code = String(children).replace(/\n$/, '')
        return (
          <div className="relative group my-3">
            <button
              onClick={() => onCopy(code)}
              className="absolute right-2 top-2 z-10 p-1 rounded text-foreground hover:text-primary hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label="Copy code"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <SyntaxHighlighter
              language={language}
              style={dark ? vscDarkPlus : oneLight}
              showLineNumbers
              wrapLines
              customStyle={{ margin: 0, borderRadius: '0.5rem', fontSize: '0.8rem' }}
            >
              {code}
            </SyntaxHighlighter>
          </div>
        )
      }

      // react-markdown appends '\n' to fenced content; inline code never has one
      const isBlock = String(children).includes('\n')

      // Case 2: unlabeled fenced block — plain monospace
      if (isBlock) {
        const code = String(children).replace(/\n$/, '')
        return (
          <pre className="font-mono text-sm bg-muted px-4 py-3 rounded-lg overflow-x-auto my-3 whitespace-pre leading-snug border border-border">
            <code>{code}</code>
          </pre>
        )
      }

      // Case 3: inline code
      return (
        <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono border border-border/60" {...props}>
          {children}
        </code>
      )
    },

    h1({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>) {
      return <h1 className="text-2xl font-bold mt-6 mb-3 leading-tight border-b border-border pb-1" {...props}>{children}</h1>
    },
    h2({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>) {
      return <h2 className="text-xl font-bold mt-5 mb-2 leading-tight border-b border-border pb-1" {...props}>{children}</h2>
    },
    h3({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>) {
      return <h3 className="text-base font-semibold mt-4 mb-1.5 leading-tight" {...props}>{children}</h3>
    },
    h4({ children, ...props }: React.ComponentPropsWithoutRef<'h4'>) {
      return <h4 className="text-sm font-semibold mt-3 mb-1" {...props}>{children}</h4>
    },
    h5({ children, ...props }: React.ComponentPropsWithoutRef<'h5'>) {
      return <h5 className="text-sm font-semibold mt-2 mb-1" {...props}>{children}</h5>
    },
    h6({ children, ...props }: React.ComponentPropsWithoutRef<'h6'>) {
      return <h6 className="text-sm font-medium mt-2 mb-1 text-muted-foreground" {...props}>{children}</h6>
    },

    p({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) {
      return <p className="leading-relaxed my-2" {...props}>{children}</p>
    },

    ul({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) {
      return <ul className="list-disc list-outside pl-5 space-y-1 my-2" {...props}>{children}</ul>
    },
    ol({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) {
      return <ol className="list-decimal list-outside pl-5 space-y-1 my-2" {...props}>{children}</ol>
    },
    li({ children, ...props }: React.ComponentPropsWithoutRef<'li'>) {
      return <li className="leading-relaxed" {...props}>{children}</li>
    },

    blockquote({ children, ...props }: React.ComponentPropsWithoutRef<'blockquote'>) {
      return (
        <blockquote className="border-l-4 border-primary/50 pl-4 py-1 my-3 italic text-muted-foreground bg-muted/30 rounded-r" {...props}>
          {children}
        </blockquote>
      )
    },

    hr({ ...props }: React.ComponentPropsWithoutRef<'hr'>) {
      return <hr className="my-5 border-border" {...props} />
    },

    table({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) {
      return (
        <div className="overflow-x-auto my-3">
          <table className="min-w-full border-collapse text-sm" {...props}>{children}</table>
        </div>
      )
    },
    thead({ children, ...props }: React.ComponentPropsWithoutRef<'thead'>) {
      return <thead className="bg-muted" {...props}>{children}</thead>
    },
    tbody({ children, ...props }: React.ComponentPropsWithoutRef<'tbody'>) {
      return <tbody className="divide-y divide-border" {...props}>{children}</tbody>
    },
    tr({ children, ...props }: React.ComponentPropsWithoutRef<'tr'>) {
      return <tr className="hover:bg-muted/50 transition-colors" {...props}>{children}</tr>
    },
    th({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) {
      return <th className="border border-border px-4 py-2 text-left font-semibold text-foreground" {...props}>{children}</th>
    },
    td({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) {
      return <td className="border border-border px-4 py-2 text-foreground/90" {...props}>{children}</td>
    },

    strong({ children, ...props }: React.ComponentPropsWithoutRef<'strong'>) {
      return <strong className="font-semibold" {...props}>{children}</strong>
    },
    em({ children, ...props }: React.ComponentPropsWithoutRef<'em'>) {
      return <em className="italic" {...props}>{children}</em>
    },
  }
}

function MarkdownPreview({ content, dark }: { content: string; dark: boolean }) {
  const handleCodeCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
  }, [])

  const components = useMemo(
    () => makeMdComponents(dark, handleCodeCopy),
    [dark, handleCodeCopy],
  )

  if (!content.trim()) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 select-none">
        <FileText className="h-10 w-10 opacity-20" />
        <p className="text-sm">Nothing to preview yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-1 text-sm leading-relaxed text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

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
  } = useMarkdownEditorStore()

  const activeDoc = docs.find((d) => d.id === activeDocId) ?? docs[0]

  // Per-document EditorState map — preserves undo history on doc switch
  const stateMapRef = useRef<Map<string, EditorState>>(new Map())
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit')
  const [sheetOpen, setSheetOpen] = useState(false)

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

  // When switching docs: save current editor state then restore (or create) target state
  const switchDoc = useCallback(
    (newId: string) => {
      if (newId === activeDocId) return

      // Save current state
      const view = editorRef.current?.view
      if (view) {
        stateMapRef.current.set(activeDocId, view.state)
      }

      setActiveDoc(newId)
    },
    [activeDocId, setActiveDoc],
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
    </div>
  )

  // ── Editor pane ───────────────────────────────────────────────────

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
      <MarkdownPreview content={activeDoc.content} dark={dark} />
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
    </div>
  )
}
