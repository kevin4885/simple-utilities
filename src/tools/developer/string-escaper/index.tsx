/**
 * String Escaper
 *
 * Two-pane layout: Input (left) → Output (right, read-only).
 * Direction toggle: Escaped → Readable (unescape) or Readable → Escaped (escape).
 * Full-bleed layout matching markdown-editor pattern.
 */

import { useCallback, useDeferredValue, useState } from 'react'
import CodeEditor from '@/components/editor/CodeEditor'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useStringEscaperStore } from './store'
import { unescapeString, escapeString } from './logic'
import { Copy, Trash2, ArrowLeftRight, Quote } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ getText, disabled }: { getText: () => string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const text = getText()
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [getText])

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} disabled={disabled} className="gap-1.5">
      <Copy className="h-3.5 w-3.5" />
      {copied ? 'Copied!' : 'Copy output'}
    </Button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StringEscaper() {
  const { direction, quotes, input, setDirection, setQuotes, setInput } =
    useStringEscaperStore()

  // Defer computation so fast typing doesn't lag
  const deferredInput = useDeferredValue(input)

  // Compute output
  const computeOutput = useCallback(
    (src: string): { value: string; error?: string } => {
      if (direction === 'unescape') {
        const r = unescapeString(src)
        return r.ok ? { value: r.value } : { value: '', error: r.error }
      } else {
        return { value: escapeString(src, { quotes }) }
      }
    },
    [direction, quotes],
  )

  const output = computeOutput(deferredInput)

  const handleSwap = useCallback(() => {
    // Swap direction and move output into input
    const { value } = computeOutput(input)
    setInput(value)
    setDirection(direction === 'unescape' ? 'escape' : 'unescape')
  }, [computeOutput, direction, input, setDirection, setInput])

  const handleClear = useCallback(() => setInput(''), [setInput])

  // Labels
  const inputLabel = direction === 'unescape' ? 'Escaped input' : 'Readable input'
  const outputLabel = direction === 'unescape' ? 'Readable output' : 'Escaped output'

  const directionLabel =
    direction === 'unescape' ? 'Escaped → Readable' : 'Readable → Escaped'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 bg-background">
        {/* Direction toggle */}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setDirection(direction === 'unescape' ? 'escape' : 'unescape')
          }
          className="gap-1.5"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          {directionLabel}
        </Button>

        {/* Swap (move output to input, flip direction) */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSwap}
          disabled={!output.value}
          className="gap-1.5"
          title="Move output to input and flip direction"
        >
          <ArrowLeftRight className="h-3.5 w-3.5 rotate-90" />
          Swap
        </Button>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        {/* Quotes option (only relevant in escape mode) */}
        <button
          onClick={() => setQuotes(!quotes)}
          disabled={direction === 'unescape'}
          className={cn(
            'flex items-center gap-1 h-6 rounded px-1.5 text-xs font-medium transition-colors',
            direction === 'unescape'
              ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground'
              : quotes
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
          title="Wrap output in double quotes (escape mode only)"
        >
          <Quote className="h-3 w-3" />
          Wrap in quotes
        </button>

        <Separator orientation="vertical" className="h-5 shrink-0" />

        {/* Copy output */}
        <CopyButton getText={() => output.value} disabled={!output.value} />

        {/* Clear */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={input === ''}
          className="gap-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
      </div>

      {/* ── Panes ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Input pane */}
        <div className="flex-1 min-w-0 flex flex-col border-r border-border overflow-hidden">
          <div className="shrink-0 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border bg-muted/40">
            {inputLabel}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <CodeEditor
              value={input}
              onChange={setInput}
              language="text"
              height="100%"
              placeholder={
                direction === 'unescape'
                  ? 'Paste escaped string here, e.g. Line 1\\nLine 2\\t\\"quoted\\"'
                  : 'Paste readable text here…'
              }
              className="h-full"
              basicSetup={{ lineNumbers: false, history: true, indentOnInput: false }}
            />
          </div>
        </div>

        {/* Output pane */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="shrink-0 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border bg-muted/40">
            {outputLabel}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {output.error ? (
              <div className="p-4 text-sm text-destructive">
                <p className="font-medium">Error</p>
                <p className="mt-1 font-mono text-xs">{output.error}</p>
              </div>
            ) : (
              <CodeEditor
                value={output.value}
                language="text"
                height="100%"
                readOnly
                className="h-full"
                basicSetup={{ lineNumbers: false, history: false, indentOnInput: false }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
