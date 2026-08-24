/**
 * JSON Formatter
 *
 * Full-bleed layout (flex flex-col h-full overflow-hidden) matching the
 * markdown-editor pattern. A CodeMirror editor with JSON language support,
 * live validation, and Format / Minify / Copy / Clear actions.
 */

import { useCallback, useDeferredValue, useState } from 'react'
import CodeEditor from '@/components/editor/CodeEditor'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useJsonFormatterStore } from './store'
import { formatJson, minifyJson, validateJson } from './logic'
import type { IndentOption } from './logic'
import {
  Braces,
  Minimize2,
  Copy,
  Trash2,
  CheckCircle2,
  XCircle,
  ArrowDownUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Indent selector ───────────────────────────────────────────────────────────

const INDENT_OPTIONS: { value: IndentOption; label: string }[] = [
  { value: 2, label: '2' },
  { value: 4, label: '4' },
  { value: 'tab', label: 'Tab' },
]

// ── Copy button with flash feedback ──────────────────────────────────────────

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const text = getText()
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [getText])

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
      <Copy className="h-3.5 w-3.5" />
      {copied ? 'Copied!' : 'Copy'}
    </Button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function JsonFormatter() {
  const { content, indent, sortKeys, setContent, setIndent, setSortKeys } =
    useJsonFormatterStore()

  // Defer validation so fast typing never lags
  const deferredContent = useDeferredValue(content)
  const validation = validateJson(deferredContent)

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleFormat = useCallback(() => {
    const result = formatJson(content, { indent, sortKeys })
    if (result !== null) setContent(result)
  }, [content, indent, sortKeys, setContent])

  const handleMinify = useCallback(() => {
    const result = minifyJson(content)
    if (result !== null) setContent(result)
  }, [content, setContent])

  const handleClear = useCallback(() => setContent(''), [setContent])

  // ── Indent toggle ──────────────────────────────────────────────────────────

  const handleIndentClick = useCallback(
    (value: IndentOption) => {
      setIndent(value)
    },
    [setIndent],
  )

  // ── Validation badge ───────────────────────────────────────────────────────

  const validationBadge = ((): React.ReactNode => {
    if (deferredContent.trim() === '') return null
    if (validation.ok) {
      return (
        <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Valid JSON
        </span>
      )
    }
    const detail =
      validation.line !== undefined
        ? ` (line ${validation.line}${validation.column !== undefined ? `, col ${validation.column}` : ''})`
        : ''
    return (
      <span className="flex items-center gap-1 text-xs text-destructive" title={validation.error}>
        <XCircle className="h-3.5 w-3.5" />
        Invalid JSON{detail}
      </span>
    )
  })()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 bg-background">
        {/* Format/Beautify */}
        <Button
          variant="default"
          size="sm"
          onClick={handleFormat}
          disabled={!validation.ok && deferredContent.trim() !== ''}
          className="gap-1.5"
        >
          <Braces className="h-3.5 w-3.5" />
          Format
        </Button>

        {/* Minify */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleMinify}
          disabled={!validation.ok && deferredContent.trim() !== ''}
          className="gap-1.5"
        >
          <Minimize2 className="h-3.5 w-3.5" />
          Minify
        </Button>

        {/* Copy */}
        <CopyButton getText={() => content} />

        {/* Clear */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={content === ''}
          className="gap-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        {/* Indent selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-0.5">Indent:</span>
          {INDENT_OPTIONS.map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => handleIndentClick(opt.value)}
              className={cn(
                'h-6 min-w-[2rem] rounded px-1.5 text-xs font-medium transition-colors',
                indent === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        {/* Sort keys */}
        <button
          onClick={() => setSortKeys(!sortKeys)}
          className={cn(
            'flex items-center gap-1 h-6 rounded px-1.5 text-xs font-medium transition-colors',
            sortKeys
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <ArrowDownUp className="h-3 w-3" />
          Sort keys
        </button>

        {/* Spacer + validation badge */}
        <div className="ml-auto">{validationBadge}</div>
      </div>

      {/* ── Editor ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeEditor
          value={content}
          onChange={setContent}
          language="json"
          height="100%"
          placeholder='Paste or type JSON here…'
          className="h-full"
        />
      </div>
    </div>
  )
}
