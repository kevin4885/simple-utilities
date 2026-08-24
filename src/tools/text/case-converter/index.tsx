/**
 * Case Converter
 *
 * Features:
 *   – Input textarea; shows all 14 case conversions at once in a results list
 *   – Each conversion row has a one-click copy button
 *   – Robust tokenizer: handles camelCase, PascalCase, acronyms, digits, separators
 *   – Multi-line: each line is converted independently
 *   – Input text persisted via Zustand store (su:case-converter)
 */

import { useCallback, useState, useMemo } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { convertAll, type ConversionResult } from './logic'
import { useCaseConverterStore } from './store'
import { Copy, Check } from 'lucide-react'

// ── ResultRow ─────────────────────────────────────────────────────────────────

function ResultRow({
  result,
  isEmpty,
}: {
  result: ConversionResult
  isEmpty: boolean
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    if (!navigator.clipboard || !result.value) return
    navigator.clipboard.writeText(result.value).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {
        /* clipboard access denied — silently ignore */
      },
    )
  }, [result.value])

  return (
    <div className="flex items-start gap-3 rounded-lg border border-input bg-muted/10 px-3 py-2.5">
      {/* Label */}
      <div className="w-44 shrink-0 pt-0.5">
        <span className="text-xs font-medium text-muted-foreground font-mono">
          {result.label}
        </span>
      </div>

      {/* Value */}
      <div className="flex-1 min-w-0">
        {isEmpty || !result.value ? (
          <span className="text-sm text-muted-foreground/50 italic">—</span>
        ) : (
          <span className="text-sm font-mono break-all text-foreground leading-relaxed whitespace-pre-wrap">
            {result.value}
          </span>
        )}
      </div>

      {/* Copy button */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground',
          copied && 'text-green-600 dark:text-green-400',
        )}
        onClick={handleCopy}
        disabled={isEmpty || !result.value}
        aria-label={`Copy ${result.label}`}
        title={`Copy ${result.label}`}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CaseConverter() {
  const { text, setText } = useCaseConverterStore()

  const isEmpty = text.trim().length === 0

  const results: ConversionResult[] = useMemo(() => convertAll(text), [text])

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Case Converter</h1>
        <p className="text-sm text-muted-foreground">
          Paste an identifier or phrase and see all case styles at once. Handles
          camelCase, acronyms (HTTPServer), digits (user2Name), and mixed
          separators. Paste multiple lines to convert each independently.
        </p>
      </div>

      {/* ── Textarea ─────────────────────────────────────────────────────────── */}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type or paste text here… e.g. helloWorld, HTTP_SERVER, my-variable-name"
        className="min-h-28 resize-y text-base leading-relaxed font-mono"
        spellCheck={false}
        aria-label="Text input"
      />

      {/* ── Results list ─────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Conversions</h2>
        <div className="space-y-1.5">
          {results.map((result) => (
            <ResultRow key={result.id} result={result} isEmpty={isEmpty} />
          ))}
        </div>
      </div>

    </div>
  )
}
