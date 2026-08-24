/**
 * Regex Tester
 *
 * Live regex matching with:
 *   – Pattern input + flag toggles (g i m s u y)
 *   – Test-string textarea with inline highlight rendering (no dangerouslySetInnerHTML)
 *   – Match list: index, full match, numbered + named capture groups
 *   – Common pattern presets dropdown
 *   – Replace section: replacement string + result preview
 *   – All state persisted via Zustand store
 */

import { useDeferredValue, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  findMatches,
  segmentText,
  applyReplace,
  flagsToString,
  PATTERN_PRESETS,
  MAX_MATCHES,
} from './logic'
import type { MatchInfo, TextSegment } from './logic'
import { useRegexTesterStore } from './store'
import {
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_FLAGS = ['g', 'i', 'm', 's', 'u', 'y'] as const
type FlagChar = (typeof ALL_FLAGS)[number]

const FLAG_DESCRIPTIONS: Record<FlagChar, string> = {
  g: 'Global — find all matches',
  i: 'Case insensitive',
  m: 'Multiline — ^ and $ match line boundaries',
  s: 'Dot-all — . matches newline too',
  u: 'Unicode — enables \\p{} and full Unicode matching',
  y: 'Sticky — match only at lastIndex',
}

// ── Alternating match highlight colours ──────────────────────────────────────
// Two OKLCH-based highlight classes so adjacent matches are visually distinct.
// We use inline styles so the highlights work in light and dark mode alike.

function getMatchHighlightStyle(matchIndex: number): React.CSSProperties {
  // Even: blue tint, Odd: orange tint (using CSS vars from the theme)
  if (matchIndex % 2 === 0) {
    return {
      backgroundColor: 'color-mix(in oklch, var(--color-primary) 25%, transparent)',
      borderRadius: '2px',
      outline: '1px solid color-mix(in oklch, var(--color-primary) 50%, transparent)',
    }
  }
  return {
    backgroundColor: 'color-mix(in oklch, var(--color-secondary) 25%, transparent)',
    borderRadius: '2px',
    outline: '1px solid color-mix(in oklch, var(--color-secondary) 50%, transparent)',
  }
}

// ── Small utility components ──────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard access denied or non-secure context — silently ignore
    }
  }, [text])
  return (
    <button
      onClick={handleCopy}
      title="Copy"
      className="p-1 rounded hover:bg-accent transition-colors shrink-0"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  )
}

// ── Flag toggle button ────────────────────────────────────────────────────────

function FlagToggle({
  flag,
  active,
  onToggle,
}: {
  flag: FlagChar
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      title={FLAG_DESCRIPTIONS[flag]}
      aria-pressed={active}
      className={cn(
        'h-7 w-7 rounded text-xs font-mono font-semibold transition-colors select-none',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {flag}
    </button>
  )
}

// ── Highlighted test string display ──────────────────────────────────────────

function HighlightedText({ segments }: { segments: TextSegment[] }) {
  return (
    <span className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">
      {segments.map((seg, i) => {
        if (!seg.isMatch) {
          return <span key={i}>{seg.text}</span>
        }
        // Zero-length match: render a thin cursor-like mark so it's still visible
        if (seg.text === '') {
          return (
            <span
              key={i}
              style={{
                borderLeft: '2px solid color-mix(in oklch, var(--color-primary) 80%, transparent)',
                marginLeft: '-1px',
              }}
              aria-label="zero-length match"
            />
          )
        }
        return (
          <mark
            key={i}
            style={getMatchHighlightStyle(seg.matchIndex)}
            className="text-foreground"
          >
            {seg.text}
          </mark>
        )
      })}
    </span>
  )
}

// ── Match list panel ──────────────────────────────────────────────────────────

function MatchCard({ match }: { match: MatchInfo }) {
  const hasGroups = match.groups.length > 0
  const hasNamedGroups = Object.keys(match.namedGroups).length > 0

  return (
    <div className="rounded-lg border border-input bg-muted/20 p-3 space-y-2 text-sm">
      <div className="flex items-start gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold tabular-nums">
            {match.matchIndex + 1}
          </span>
          <span className="font-mono break-all text-foreground">
            {match.fullMatch === '' ? (
              <span className="text-muted-foreground italic text-xs">zero-length match</span>
            ) : (
              match.fullMatch
            )}
          </span>
        </div>
        <div className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          <span>{match.startIndex}–{match.endIndex}</span>
          <CopyButton text={match.fullMatch} />
        </div>
      </div>

      {/* Numbered capture groups */}
      {hasGroups && (
        <div className="pl-8 space-y-1">
          {match.groups.map((g, gi) => (
            <div key={gi} className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs shrink-0">
                ${gi + 1}
              </span>
              <span className="font-mono text-xs break-all text-foreground">
                {g === undefined ? (
                  <span className="text-muted-foreground italic">undefined</span>
                ) : (
                  g
                )}
              </span>
              {g !== undefined && <CopyButton text={g} />}
            </div>
          ))}
        </div>
      )}

      {/* Named capture groups */}
      {hasNamedGroups && (
        <div className="pl-8 space-y-1">
          {Object.entries(match.namedGroups).map(([name, val]) => (
            <div key={name} className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs shrink-0 font-mono">
                ${`<${name}>`}
              </span>
              <span className="font-mono text-xs break-all text-foreground">
                {val === undefined ? (
                  <span className="text-muted-foreground italic">undefined</span>
                ) : (
                  val
                )}
              </span>
              {val !== undefined && <CopyButton text={val} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RegexTester() {
  const {
    pattern,
    flagG,
    flagI,
    flagM,
    flagS,
    flagU,
    flagY,
    testString,
    replacement,
    showReplace,
    setPattern,
    setFlagG,
    setFlagI,
    setFlagM,
    setFlagS,
    setFlagU,
    setFlagY,
    setTestString,
    setReplacement,
    setShowReplace,
  } = useRegexTesterStore()

  // Dropdown state for presets
  const [presetsOpen, setPresetsOpen] = useState(false)
  const presetsRef = useRef<HTMLDivElement>(null)

  // Close presets dropdown on outside click
  useEffect(() => {
    if (!presetsOpen) return
    function handleClick(e: MouseEvent) {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setPresetsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [presetsOpen])

  // Build flags string from booleans
  const flagsStr = flagsToString({ g: flagG, i: flagI, m: flagM, s: flagS, u: flagU, y: flagY })

  // Flag setter map
  const flagSetters: Record<FlagChar, (v: boolean) => void> = {
    g: setFlagG,
    i: setFlagI,
    m: setFlagM,
    s: setFlagS,
    u: setFlagU,
    y: setFlagY,
  }
  const flagValues: Record<FlagChar, boolean> = {
    g: flagG,
    i: flagI,
    m: flagM,
    s: flagS,
    u: flagU,
    y: flagY,
  }

  // Defer expensive computation until the user pauses typing
  const deferredPattern = useDeferredValue(pattern)
  const deferredFlags = useDeferredValue(flagsStr)
  const deferredTest = useDeferredValue(testString)
  const deferredReplacement = useDeferredValue(replacement)

  // Compute matches
  const matchResult = useMemo(
    () => findMatches(deferredPattern, deferredFlags, deferredTest),
    [deferredPattern, deferredFlags, deferredTest],
  )

  // Compute highlight segments
  const segments = useMemo(() => {
    if (!matchResult.ok || matchResult.matches.length === 0) {
      return [{ text: deferredTest, isMatch: false, matchIndex: -1 }] as ReturnType<
        typeof segmentText
      >
    }
    return segmentText(deferredTest, matchResult.matches)
  }, [matchResult, deferredTest])

  // Compute replace result
  const replaceResult = useMemo(() => {
    if (!showReplace) return null
    return applyReplace(deferredPattern, deferredFlags, deferredTest, deferredReplacement)
  }, [showReplace, deferredPattern, deferredFlags, deferredTest, deferredReplacement])

  // Summary stats
  const matchCount = matchResult.ok ? matchResult.matches.length : 0
  const patternError = matchResult.ok ? null : matchResult.error

  // Pattern display in header: /pattern/flags
  const regexDisplay = pattern ? `/${pattern}/${flagsStr}` : ''

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">

      {/* ── Pattern row ──────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="regex-pattern" className="text-sm font-medium">
            Pattern
          </Label>
          {/* Presets dropdown */}
          <div className="relative" ref={presetsRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPresetsOpen((o) => !o)}
              className="gap-1.5 text-xs h-7"
            >
              Presets
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            {presetsOpen && (
              <div className="absolute right-0 z-50 mt-1 w-64 rounded-lg border border-input bg-popover shadow-md overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  {PATTERN_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => {
                        setPattern(preset.pattern)
                        // Apply preset flags
                        setFlagG(preset.flags.includes('g'))
                        setFlagI(preset.flags.includes('i'))
                        setFlagM(preset.flags.includes('m'))
                        setFlagS(preset.flags.includes('s'))
                        setFlagU(preset.flags.includes('u'))
                        setFlagY(preset.flags.includes('y'))
                        setPresetsOpen(false)
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <div className="text-sm font-medium text-foreground">{preset.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {preset.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pattern input + flags */}
        <div className="flex items-center gap-2">
          {/* Slash prefix */}
          <span className="text-muted-foreground font-mono text-lg select-none shrink-0">/</span>
          <Input
            id="regex-pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="pattern"
            className="font-mono flex-1"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {/* Slash suffix */}
          <span className="text-muted-foreground font-mono text-lg select-none shrink-0">/</span>
          {/* Flag toggles */}
          <div className="flex items-center gap-1 shrink-0">
            {ALL_FLAGS.map((f) => (
              <FlagToggle
                key={f}
                flag={f}
                active={flagValues[f]}
                onToggle={() => flagSetters[f](!flagValues[f])}
              />
            ))}
          </div>
        </div>

        {/* Error message */}
        {patternError && pattern && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{patternError}</span>
          </div>
        )}

        {/* Parsed regex display */}
        {pattern && !patternError && regexDisplay && (
          <p className="text-xs text-muted-foreground font-mono">{regexDisplay}</p>
        )}
      </div>

      {/* ── Test string ───────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="test-string" className="text-sm font-medium">
            Test string
          </Label>
          {matchResult.ok && pattern && testString && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {matchCount === 0
                ? 'No matches'
                : matchCount === 1
                  ? '1 match'
                  : `${matchCount} matches`}
              {matchResult.truncated && ` (first ${MAX_MATCHES} shown)`}
            </span>
          )}
        </div>

        {/* Stacked: textarea for editing, highlight overlay below */}
        <Textarea
          id="test-string"
          value={testString}
          onChange={(e) => setTestString(e.target.value)}
          placeholder="Enter test string here…"
          rows={6}
          className="font-mono text-sm resize-y"
          spellCheck={false}
        />

        {/* Highlighted preview — only shown when there are matches */}
        {matchResult.ok && matchCount > 0 && testString && (
          <div className="rounded-md border border-input bg-muted/20 px-3 py-2.5 min-h-[4rem]">
            <p className="text-xs text-muted-foreground mb-1.5 font-medium">Highlight preview</p>
            <HighlightedText segments={segments} />
          </div>
        )}
      </div>

      {/* ── Match list ────────────────────────────────────────────────────── */}
      {matchResult.ok && matchCount > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">
              Matches
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                ({matchCount}{matchResult.truncated ? `+` : ''})
              </span>
            </Label>
            {matchCount > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={async () => {
                  const all = matchResult.matches.map((m) => m.fullMatch).join('\n')
                  try {
                    await navigator.clipboard.writeText(all)
                  } catch {
                    // clipboard access denied — ignore
                  }
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy all
              </Button>
            )}
          </div>

          {matchResult.truncated && (
            <p className="text-xs text-muted-foreground">
              Showing first {MAX_MATCHES} of many matches. Refine your pattern to see fewer results.
            </p>
          )}

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {matchResult.matches.map((m) => (
              <MatchCard key={m.matchIndex} match={m} />
            ))}
          </div>
        </div>
      )}

      {/* No-match state */}
      {matchResult.ok && pattern && testString && matchCount === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No matches found.
        </p>
      )}

      {/* ── Replace section ───────────────────────────────────────────────── */}
      <div className="border border-input rounded-lg overflow-hidden">
        <button
          onClick={() => setShowReplace(!showReplace)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors text-left"
        >
          {showReplace ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          Replace
          <span className="text-xs font-normal text-muted-foreground ml-1">
            — preview .replace() result
          </span>
        </button>

        {showReplace && (
          <div className="px-4 pb-4 space-y-3 border-t border-input">
            <div className="space-y-1.5 pt-3">
              <Label htmlFor="replacement" className="text-sm font-medium">
                Replacement
              </Label>
              <Input
                id="replacement"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="Replacement string… ($1, $<name>, $&)"
                className="font-mono text-sm"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Supports{' '}
                <code className="bg-muted px-1 rounded text-xs">$1</code>,{' '}
                <code className="bg-muted px-1 rounded text-xs">${'<name>'}</code>,{' '}
                <code className="bg-muted px-1 rounded text-xs">$&</code> (full match),{' '}
                <code className="bg-muted px-1 rounded text-xs">$$</code> (literal $)
              </p>
            </div>

            {replaceResult && pattern && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Result</Label>
                {replaceResult.ok ? (
                  <div className="relative">
                    <div className="rounded-md border border-input bg-muted/20 px-3 py-2.5 font-mono text-sm whitespace-pre-wrap break-words min-h-[2.5rem] pr-8">
                      {replaceResult.output || (
                        <span className="text-muted-foreground italic text-xs">empty string</span>
                      )}
                    </div>
                    <div className="absolute top-2 right-2">
                      <CopyButton text={replaceResult.output} />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{replaceResult.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
