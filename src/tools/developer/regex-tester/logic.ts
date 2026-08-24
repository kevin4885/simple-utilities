/**
 * Regex Tester — pure logic (no React, no side-effects)
 *
 * Exports:
 *   buildRegex        — compile a pattern+flags string to RegExp (or error)
 *   findMatches       — execute the regex against text; returns structured matches
 *   segmentText       — split text into highlighted/plain segments for rendering
 *   applyReplace      — run String.prototype.replace with $1/$<name> support
 *   flagsToString     — convert RegexFlags object → flag string ("gim", etc.)
 *   parseFlagsString  — convert flag string → RegexFlags object
 *   PATTERN_PRESETS   — built-in common-pattern library
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum matches returned by findMatches before truncation is flagged. */
export const MAX_MATCHES = 1000

// ── Types ─────────────────────────────────────────────────────────────────────

/** Which regex flags are currently active. */
export interface RegexFlags {
  g: boolean
  i: boolean
  m: boolean
  s: boolean
  u: boolean
  y: boolean
}

/** One regex match with position info and all capture groups. */
export interface MatchInfo {
  /** 0-based ordinal (first match = 0). */
  matchIndex: number
  /** Full match string (may be empty for zero-length matches). */
  fullMatch: string
  /** Inclusive start index in the source text. */
  startIndex: number
  /** Exclusive end index in the source text. */
  endIndex: number
  /** Numbered capture groups: groups[0] = m[1], groups[1] = m[2], …
   *  undefined when a group didn't participate in the match. */
  groups: Array<string | undefined>
  /** Named capture groups from m.groups (empty object if none). */
  namedGroups: Record<string, string | undefined>
}

/** One segment of the test string for highlight rendering. */
export interface TextSegment {
  /** Slice of the original text. May be empty for zero-length matches. */
  text: string
  /** True when this segment is a matched region. */
  isMatch: boolean
  /** 0-based match ordinal; -1 if not a match (used for alternating colors). */
  matchIndex: number
}

export type BuildRegexResult =
  | { ok: true; regex: RegExp }
  | { ok: false; error: string }

export type FindMatchesResult =
  | { ok: true; matches: MatchInfo[]; truncated: boolean }
  | { ok: false; error: string }

export type ApplyReplaceResult =
  | { ok: true; output: string }
  | { ok: false; error: string }

// ── Common pattern presets ────────────────────────────────────────────────────

export interface PatternPreset {
  label: string
  pattern: string
  flags: string
  description: string
}

export const PATTERN_PRESETS: PatternPreset[] = [
  {
    label: 'Email',
    pattern: '[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}',
    flags: 'g',
    description: 'Basic email address',
  },
  {
    label: 'URL (http/https)',
    pattern: 'https?:\\/\\/[^\\s/$.?#].[^\\s]*',
    flags: 'gi',
    description: 'HTTP or HTTPS URL',
  },
  {
    label: 'IPv4 Address',
    pattern:
      '\\b(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]\\d|\\d)){3}\\b',
    flags: 'g',
    description: 'IPv4 address (0.0.0.0 – 255.255.255.255)',
  },
  {
    label: 'ISO Date (YYYY-MM-DD)',
    pattern: '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])',
    flags: 'g',
    description: 'ISO 8601 date',
  },
  {
    label: 'UUID',
    pattern:
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
    flags: 'gi',
    description: 'UUID (any version)',
  },
  {
    label: 'Hex Color',
    pattern: '#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\b',
    flags: 'g',
    description: 'CSS hex color (#rgb or #rrggbb)',
  },
  {
    label: 'Phone (US-ish)',
    pattern: '\\+?1?[\\s\\-.]?\\(?\\d{3}\\)?[\\s\\-.]?\\d{3}[\\s\\-.]?\\d{4}',
    flags: 'g',
    description: 'US-style phone number (loose match)',
  },
  {
    label: 'Whitespace Trim',
    pattern: '^\\s+|\\s+$',
    flags: 'gm',
    description: 'Leading / trailing whitespace per line',
  },
  {
    label: 'HTML Tag',
    pattern: '<[^>]+>',
    flags: 'g',
    description: 'HTML / XML tag',
  },
  {
    label: 'Credit Card (16-digit)',
    pattern: '\\b\\d{4}[\\s\\-]?\\d{4}[\\s\\-]?\\d{4}[\\s\\-]?\\d{4}\\b',
    flags: 'g',
    description: '16-digit credit card number',
  },
]

// ── Flag helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a RegexFlags object to a concatenated flag string (e.g. "gim").
 * Order follows the ECMAScript toString canonical order (g i m s u y).
 */
export function flagsToString(flags: RegexFlags): string {
  return (
    (flags.g ? 'g' : '') +
    (flags.i ? 'i' : '') +
    (flags.m ? 'm' : '') +
    (flags.s ? 's' : '') +
    (flags.u ? 'u' : '') +
    (flags.y ? 'y' : '')
  )
}

/**
 * Convert a flag string (e.g. "gim") back to a RegexFlags object.
 * Any unrecognised characters are ignored.
 */
export function parseFlagsString(flags: string): RegexFlags {
  return {
    g: flags.includes('g'),
    i: flags.includes('i'),
    m: flags.includes('m'),
    s: flags.includes('s'),
    u: flags.includes('u'),
    y: flags.includes('y'),
  }
}

// ── Error formatting ──────────────────────────────────────────────────────────

/**
 * Strip V8's verbose "Invalid regular expression: /pat/flags: " preamble,
 * leaving only the human-readable reason.
 */
function friendlyRegexError(e: unknown): string {
  if (e instanceof SyntaxError) {
    // V8 format: "Invalid regular expression: /pattern/flags: Reason here"
    return e.message.replace(/^Invalid regular expression:.*?: /, '')
  }
  return e instanceof Error ? e.message : String(e)
}

// ── buildRegex ────────────────────────────────────────────────────────────────

/**
 * Attempt to compile a RegExp from a pattern string and flag string.
 *
 * Returns `{ ok: true, regex }` on success or `{ ok: false, error }` for any
 * SyntaxError (invalid pattern / invalid flag combination).
 *
 * An empty pattern is treated as an error so the UI can show an empty-state
 * rather than a "matches everything" result.
 */
export function buildRegex(pattern: string, flags: string): BuildRegexResult {
  if (!pattern) return { ok: false, error: 'Pattern is empty.' }
  try {
    return { ok: true, regex: new RegExp(pattern, flags) }
  } catch (e) {
    return { ok: false, error: friendlyRegexError(e) }
  }
}

// ── findMatches ───────────────────────────────────────────────────────────────

/**
 * Find all matches of `pattern` (with `flags`) inside `text`.
 *
 * Behaviour:
 * - Empty pattern → `{ ok: true, matches: [], truncated: false }` (no error).
 * - Invalid pattern / flags → `{ ok: false, error }`.
 * - Always adds the 'g' flag so RegExp.exec() iterates; the user's other flags
 *   are preserved unchanged.
 * - Zero-length match guard: if the engine doesn't advance `lastIndex` past a
 *   zero-length match position, we do it manually (prevents infinite loops in
 *   environments that predate the ES2015 automatic-advancement spec).
 * - Caps at MAX_MATCHES (1000); sets `truncated: true` when more matches exist.
 */
export function findMatches(
  pattern: string,
  flags: string,
  text: string,
): FindMatchesResult {
  if (!pattern) return { ok: true, matches: [], truncated: false }

  // Always add 'g' so exec() iterates over all matches
  const effectiveFlags = flags.includes('g') ? flags : flags + 'g'

  let re: RegExp
  try {
    re = new RegExp(pattern, effectiveFlags)
  } catch (e) {
    return { ok: false, error: friendlyRegexError(e) }
  }

  const matches: MatchInfo[] = []

  for (;;) {
    const m = re.exec(text)
    if (m === null) break

    // Zero-length match guard: ensure lastIndex advances to prevent infinite loops.
    // Modern V8 (ES2015+) already does this per spec; we guard explicitly for safety.
    if (m[0].length === 0 && re.lastIndex <= m.index) {
      re.lastIndex = m.index + 1
    }

    // If we've already collected MAX_MATCHES results, one more means truncated
    if (matches.length >= MAX_MATCHES) {
      return { ok: true, matches, truncated: true }
    }

    const groups: Array<string | undefined> = []
    for (let gi = 1; gi < m.length; gi++) {
      groups.push(m[gi])
    }

    matches.push({
      matchIndex: matches.length,
      fullMatch: m[0],
      startIndex: m.index,
      endIndex: m.index + m[0].length,
      groups,
      namedGroups: m.groups
        ? (m.groups as Record<string, string | undefined>)
        : {},
    })
  }

  return { ok: true, matches, truncated: false }
}

// ── segmentText ───────────────────────────────────────────────────────────────

/**
 * Split `text` into an ordered array of plain / matched segments for rendering.
 *
 * Assumes matches are non-overlapping and in ascending startIndex order (as
 * produced by findMatches). Zero-length matches produce a segment with
 * `text === ''` and `isMatch === true` — these render as invisible but
 * structurally valid elements, preventing crashes in the UI loop.
 */
export function segmentText(text: string, matches: MatchInfo[]): TextSegment[] {
  if (matches.length === 0) {
    return [{ text, isMatch: false, matchIndex: -1 }]
  }

  const segments: TextSegment[] = []
  let pos = 0

  for (const match of matches) {
    // Plain text before this match
    if (match.startIndex > pos) {
      segments.push({
        text: text.slice(pos, match.startIndex),
        isMatch: false,
        matchIndex: -1,
      })
    }
    // The matched region (may be zero-length)
    segments.push({
      text: match.fullMatch,
      isMatch: true,
      matchIndex: match.matchIndex,
    })
    pos = match.endIndex
  }

  // Remaining plain text after the last match
  if (pos < text.length) {
    segments.push({ text: text.slice(pos), isMatch: false, matchIndex: -1 })
  }

  return segments
}

// ── applyReplace ──────────────────────────────────────────────────────────────

/**
 * Apply String.prototype.replace() using the given pattern, flags, and
 * replacement string.
 *
 * The replacement supports standard substitution patterns:
 *   $&  full match    $1 / $2  numbered groups    $<name>  named group
 *   $$  literal $     $`  before match             $'  after match
 *
 * Returns `{ ok: true, output }` on success or `{ ok: false, error }` on any
 * SyntaxError (bad pattern / flags).
 */
export function applyReplace(
  pattern: string,
  flags: string,
  text: string,
  replacement: string,
): ApplyReplaceResult {
  if (!pattern) return { ok: false, error: 'Pattern is empty.' }
  try {
    const re = new RegExp(pattern, flags)
    const output = text.replace(re, replacement)
    return { ok: true, output }
  } catch (e) {
    return { ok: false, error: friendlyRegexError(e) }
  }
}
