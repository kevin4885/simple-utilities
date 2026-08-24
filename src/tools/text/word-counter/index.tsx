/**
 * Word & Character Counter
 *
 * Features:
 *   – Large textarea with live stats as the user types
 *   – Words, characters (with/without spaces), sentences, paragraphs, lines
 *   – Reading time (~225 wpm) and speaking time (~150 wpm) as friendly durations
 *   – Word frequency: top 10 most common words (case-insensitive), with stopword toggle
 *   – Character extra stats: letters, digits, punctuation, whitespace
 *   – Copy button for a plain-text stats summary
 *   – Text and stopword toggle persisted via Zustand store (su:word-counter)
 */

import { useMemo, useCallback, useState, useRef, useEffect } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  computeStats,
  wordFrequency,
  formatDuration,
  buildStatsSummary,
  type WordFrequencyEntry,
} from './logic'
import { useWordCounterStore } from './store'
import { Copy, Check } from 'lucide-react'

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: number | string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 space-y-0.5 text-center',
        highlight
          ? 'border-primary/40 bg-primary/5'
          : 'border-input bg-muted/10',
      )}
    >
      <div
        className={cn(
          'text-2xl font-bold tabular-nums leading-tight',
          highlight ? 'text-primary' : 'text-foreground',
        )}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-xs text-muted-foreground font-medium">{label}</div>
    </div>
  )
}

// ── FrequencyTable ────────────────────────────────────────────────────────────

function FrequencyTable({
  entries,
  isEmpty,
}: {
  entries: WordFrequencyEntry[]
  isEmpty: boolean
}) {
  if (isEmpty) {
    return (
      <div className="rounded-lg border border-input bg-muted/20 px-4 py-5 text-center text-sm text-muted-foreground">
        Enter some text above to see word frequency.
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-input bg-muted/20 px-4 py-5 text-center text-sm text-muted-foreground">
        No content words found. Try disabling the stopword filter.
      </div>
    )
  }

  const maxCount = entries[0]?.count ?? 1

  return (
    <div className="overflow-hidden rounded-lg border border-input">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-input bg-muted/30">
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-8">
              #
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Word
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground w-16">
              Count
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground w-24 hidden sm:table-cell">
              Frequency
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => {
            const pct = maxCount > 0 ? Math.round((entry.count / maxCount) * 100) : 0
            return (
              <tr
                key={entry.word}
                className="border-b border-input last:border-0"
              >
                <td className="px-3 py-2 text-muted-foreground text-xs">{i + 1}</td>
                <td className="px-3 py-2 font-mono font-medium text-foreground">
                  {entry.word}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-foreground">
                  {entry.count}
                </td>
                <td className="px-3 py-2 hidden sm:table-cell">
                  {/* Mini bar */}
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-1.5 rounded-full bg-muted/60 w-16 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/60"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WordCounter() {
  const { text, setText, excludeStopwords, setExcludeStopwords } = useWordCounterStore()
  const { copy, copied } = useCopyToClipboard()

  // Debounced text for frequency table (avoids re-running on every keystroke)
  const [debouncedText, setDebouncedText] = useState(text)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedText(text)
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [text])

  // Stats — computed live from current text
  const stats = useMemo(() => computeStats(text), [text])

  // Frequency — debounced, depends on stopword toggle too
  const freqEntries = useMemo(
    () => wordFrequency(debouncedText, { excludeStopwords, topN: 10 }),
    [debouncedText, excludeStopwords],
  )

  const handleCopy = useCallback(() => {
    const summary = buildStatsSummary(stats)
    copy(summary)
  }, [stats, copy])

  const isEmpty = text.trim().length === 0

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Word &amp; Character Counter</h1>
        <p className="text-sm text-muted-foreground">
          Paste or type your text below for live word, character, sentence, and readability stats.
        </p>
      </div>

      {/* ── Textarea ─────────────────────────────────────────────────────────── */}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start typing or paste your text here…"
        className="min-h-48 resize-y text-base leading-relaxed font-mono"
        spellCheck
        aria-label="Text input"
      />

      {/* ── Primary stats grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Words" value={stats.words} highlight />
        <StatCard label="Characters" value={stats.chars.total} />
        <StatCard label="Chars (no spaces)" value={stats.chars.noSpaces} />
        <StatCard label="Sentences" value={stats.sentences} />
        <StatCard label="Paragraphs" value={stats.paragraphs} />
      </div>

      {/* ── Secondary stats row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Lines" value={stats.lines} />
        <StatCard label="Letters" value={stats.chars.letters} />
        <StatCard label="Digits" value={stats.chars.digits} />
        <StatCard label="Punctuation" value={stats.chars.punctuation} />
      </div>

      {/* ── Time estimates ───────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-input bg-muted/10 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Time Estimates</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-0.5">
            <div className="text-xs text-muted-foreground font-medium">
              Reading time <span className="font-normal">(~225 wpm)</span>
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {formatDuration(stats.readingSecs)}
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-xs text-muted-foreground font-medium">
              Speaking time <span className="font-normal">(~150 wpm)</span>
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {formatDuration(stats.speakingSecs)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Word Frequency ───────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            Top 10 Words by Frequency
          </h2>
          <div className="flex items-center gap-2">
            <Checkbox
              id="exclude-stopwords"
              checked={excludeStopwords}
              onCheckedChange={(v) => setExcludeStopwords(v === true)}
            />
            <Label
              htmlFor="exclude-stopwords"
              className="text-sm cursor-pointer select-none"
            >
              Exclude common words
            </Label>
          </div>
        </div>
        <FrequencyTable entries={freqEntries} isEmpty={isEmpty} />
      </div>

      {/* ── Copy summary ─────────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          disabled={isEmpty}
          className={cn(copied && 'text-green-600 dark:text-green-400')}
        >
          {copied ? (
            <>
              <Check />
              Copied!
            </>
          ) : (
            <>
              <Copy />
              Copy stats summary
            </>
          )}
        </Button>
      </div>

    </div>
  )
}

// ── useCopyToClipboard ────────────────────────────────────────────────────────

function useCopyToClipboard(timeoutMs = 1500) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(
    (text: string) => {
      if (!navigator.clipboard) return
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true)
          setTimeout(() => setCopied(false), timeoutMs)
        },
        () => {
          /* clipboard access denied — silently ignore */
        },
      )
    },
    [timeoutMs],
  )

  return { copied, copy }
}
