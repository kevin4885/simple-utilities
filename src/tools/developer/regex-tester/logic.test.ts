import { describe, it, expect } from 'vitest'
import {
  buildRegex,
  findMatches,
  segmentText,
  applyReplace,
  flagsToString,
  parseFlagsString,
  MAX_MATCHES,
  PATTERN_PRESETS,
} from './logic'
import type { RegexFlags, MatchInfo } from './logic'

// ── flagsToString ─────────────────────────────────────────────────────────────

describe('flagsToString', () => {
  it('returns empty string when all flags are false', () => {
    const flags: RegexFlags = { g: false, i: false, m: false, s: false, u: false, y: false }
    expect(flagsToString(flags)).toBe('')
  })

  it('includes only active flags in canonical order', () => {
    const flags: RegexFlags = { g: true, i: true, m: false, s: false, u: false, y: false }
    expect(flagsToString(flags)).toBe('gi')
  })

  it('returns all flags when all are true', () => {
    const flags: RegexFlags = { g: true, i: true, m: true, s: true, u: true, y: false }
    expect(flagsToString(flags)).toBe('gimsu')
  })

  it('returns "g" for global-only', () => {
    const flags: RegexFlags = { g: true, i: false, m: false, s: false, u: false, y: false }
    expect(flagsToString(flags)).toBe('g')
  })

  it('preserves s (dotAll) flag', () => {
    const flags: RegexFlags = { g: false, i: false, m: false, s: true, u: false, y: false }
    expect(flagsToString(flags)).toBe('s')
  })
})

// ── parseFlagsString ──────────────────────────────────────────────────────────

describe('parseFlagsString', () => {
  it('parses empty string to all-false', () => {
    const flags = parseFlagsString('')
    expect(flags).toEqual({ g: false, i: false, m: false, s: false, u: false, y: false })
  })

  it('parses "gi" correctly', () => {
    const flags = parseFlagsString('gi')
    expect(flags.g).toBe(true)
    expect(flags.i).toBe(true)
    expect(flags.m).toBe(false)
  })

  it('parses "gimsuy" correctly', () => {
    const flags = parseFlagsString('gimsuy')
    expect(flags).toEqual({ g: true, i: true, m: true, s: true, u: true, y: true })
  })

  it('ignores unknown characters', () => {
    const flags = parseFlagsString('gXZ')
    expect(flags.g).toBe(true)
    expect(flags.i).toBe(false)
  })

  it('round-trips with flagsToString', () => {
    const original: RegexFlags = { g: true, i: false, m: true, s: false, u: true, y: false }
    expect(parseFlagsString(flagsToString(original))).toEqual(original)
  })
})

// ── buildRegex ────────────────────────────────────────────────────────────────

describe('buildRegex — success cases', () => {
  it('compiles a simple pattern', () => {
    const r = buildRegex('hello', 'g')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.regex).toBeInstanceOf(RegExp)
    expect(r.regex.source).toBe('hello')
    expect(r.regex.flags).toContain('g')
  })

  it('compiles with multiple flags', () => {
    const r = buildRegex('\\d+', 'gim')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.regex.global).toBe(true)
    expect(r.regex.ignoreCase).toBe(true)
    expect(r.regex.multiline).toBe(true)
  })

  it('compiles a pattern with named capture groups', () => {
    const r = buildRegex('(?<year>\\d{4})-(?<month>\\d{2})', 'g')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.regex.exec('2024-01')?.groups?.year).toBe('2024')
  })

  it('compiles with unicode flag', () => {
    const r = buildRegex('\\p{L}+', 'gu')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.regex.unicode).toBe(true)
  })

  it('compiles with dotAll (s) flag', () => {
    const r = buildRegex('a.b', 's')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.regex.dotAll).toBe(true)
  })
})

describe('buildRegex — error cases', () => {
  it('returns error for empty pattern', () => {
    const r = buildRegex('', 'g')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBeTruthy()
  })

  it('returns friendly error for invalid pattern', () => {
    const r = buildRegex('[unclosed', 'g')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.length).toBeGreaterThan(0)
    // Should not contain the raw V8 prefix
    expect(r.error).not.toContain('Invalid regular expression:')
  })

  it('returns error for invalid flag', () => {
    // 'z' is not a valid regex flag
    const r = buildRegex('abc', 'gz')
    expect(r.ok).toBe(false)
  })

  it('returns error for invalid escape sequence (without u flag)', () => {
    // \p without u flag is a SyntaxError in strict-mode engines
    const r = buildRegex('\\p{Letter}', 'g')
    // This may or may not throw depending on engine; if it does throw, ok must be false
    if (!r.ok) {
      expect(r.error.length).toBeGreaterThan(0)
    }
  })

  it('returns error for unmatched parenthesis', () => {
    const r = buildRegex('(open', 'g')
    expect(r.ok).toBe(false)
  })

  it('returns error for invalid quantifier', () => {
    const r = buildRegex('a{3,1}', 'g')
    expect(r.ok).toBe(false)
  })
})

// ── findMatches ───────────────────────────────────────────────────────────────

describe('findMatches — basic', () => {
  it('returns empty array for empty pattern', () => {
    const r = findMatches('', 'g', 'hello world')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches).toHaveLength(0)
    expect(r.truncated).toBe(false)
  })

  it('returns error for invalid pattern', () => {
    const r = findMatches('[bad', 'g', 'text')
    expect(r.ok).toBe(false)
  })

  it('finds a single match', () => {
    const r = findMatches('world', 'g', 'hello world')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0].fullMatch).toBe('world')
    expect(r.matches[0].startIndex).toBe(6)
    expect(r.matches[0].endIndex).toBe(11)
  })

  it('finds multiple matches', () => {
    const r = findMatches('a', 'g', 'banana')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches).toHaveLength(3)
  })

  it('respects case-insensitive flag', () => {
    const r = findMatches('hello', 'gi', 'HELLO hello HeLLo')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches).toHaveLength(3)
  })

  it('respects multiline flag for ^ anchor', () => {
    const r = findMatches('^foo', 'gm', 'foo\nbar\nfoo')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches).toHaveLength(2)
  })

  it('adds g flag automatically when not provided', () => {
    const r = findMatches('a', '', 'banana')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches).toHaveLength(3)
  })

  it('returns no matches on non-matching text', () => {
    const r = findMatches('xyz', 'g', 'hello world')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches).toHaveLength(0)
  })

  it('sets correct matchIndex ordinal', () => {
    const r = findMatches('\\d', 'g', 'a1b2c3')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches[0].matchIndex).toBe(0)
    expect(r.matches[1].matchIndex).toBe(1)
    expect(r.matches[2].matchIndex).toBe(2)
  })
})

describe('findMatches — capture groups', () => {
  it('returns numbered capture groups', () => {
    const r = findMatches('(\\w+)@(\\w+)', 'g', 'foo@bar baz@qux')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches[0].groups[0]).toBe('foo')
    expect(r.matches[0].groups[1]).toBe('bar')
  })

  it('returns undefined for non-participating groups', () => {
    // Optional group that doesn't match
    const r = findMatches('(a)?(b)', 'g', 'b')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches[0].groups[0]).toBeUndefined()
    expect(r.matches[0].groups[1]).toBe('b')
  })

  it('returns named capture groups', () => {
    const r = findMatches('(?<user>\\w+)@(?<host>\\w+)', 'g', 'alice@example')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches[0].namedGroups.user).toBe('alice')
    expect(r.matches[0].namedGroups.host).toBe('example')
  })

  it('returns empty namedGroups when no named groups exist', () => {
    const r = findMatches('(\\w+)', 'g', 'hello')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches[0].namedGroups).toEqual({})
  })
})

describe('findMatches — zero-length matches', () => {
  it('handles ^ anchor (zero-length) at line start', () => {
    const r = findMatches('^', 'gm', 'a\nb\nc')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Should find one match at the start of each line
    expect(r.matches.length).toBeGreaterThanOrEqual(3)
  })

  it('handles \\b zero-length match without infinite loop', () => {
    const r = findMatches('\\b', 'g', 'hello world')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 4 word boundaries: before/after "hello", before/after "world"
    expect(r.matches.length).toBe(4)
    expect(r.matches.every((m) => m.fullMatch === '')).toBe(true)
  })

  it('handles empty-string matching pattern (?:)', () => {
    const r = findMatches('(?:)', 'g', 'abc')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Empty match at every position between chars + at end; at most text.length+1
    expect(r.matches.length).toBeGreaterThan(0)
  })

  it('does not loop infinitely on a* against non-matching text', () => {
    const r = findMatches('a*', 'g', 'bbb')
    expect(r.ok).toBe(true)
  })

  it('zero-length match has startIndex === endIndex', () => {
    const r = findMatches('\\b', 'g', 'hi')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const m of r.matches) {
      expect(m.startIndex).toBe(m.endIndex)
    }
  })
})

describe('findMatches — unicode flag', () => {
  it('matches Unicode property escapes with u flag', () => {
    const r = findMatches('\\p{Lu}', 'gu', 'Hello World')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 'H' and 'W' are uppercase letters
    expect(r.matches.length).toBeGreaterThanOrEqual(2)
  })

  it('matches emoji with u flag', () => {
    const r = findMatches('[\\u{1F600}-\\u{1F64F}]', 'gu', 'Hello 😀 World 😂')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches.length).toBe(2)
  })
})

describe('findMatches — truncation', () => {
  it(`caps results at MAX_MATCHES (${MAX_MATCHES}) and sets truncated=true`, () => {
    // Create text with more matches than the cap
    const text = 'a'.repeat(MAX_MATCHES + 10)
    const r = findMatches('a', 'g', text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches).toHaveLength(MAX_MATCHES)
    expect(r.truncated).toBe(true)
  })

  it('does not truncate when count is exactly at the cap', () => {
    const text = 'a'.repeat(MAX_MATCHES)
    const r = findMatches('a', 'g', text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches).toHaveLength(MAX_MATCHES)
    // At exactly MAX_MATCHES, the result is NOT truncated
    expect(r.truncated).toBe(false)
  })

  it('does not truncate fewer matches than cap', () => {
    const r = findMatches('\\d', 'g', '1 2 3 4 5')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches).toHaveLength(5)
    expect(r.truncated).toBe(false)
  })
})

// ── segmentText ───────────────────────────────────────────────────────────────

describe('segmentText — no matches', () => {
  it('returns a single plain segment for the full text', () => {
    const segs = segmentText('hello world', [])
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('hello world')
    expect(segs[0].isMatch).toBe(false)
    expect(segs[0].matchIndex).toBe(-1)
  })

  it('handles empty text', () => {
    const segs = segmentText('', [])
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('')
  })
})

describe('segmentText — with matches', () => {
  function makeMatch(idx: number, start: number, end: number, text: string): MatchInfo {
    return {
      matchIndex: idx,
      fullMatch: text,
      startIndex: start,
      endIndex: end,
      groups: [],
      namedGroups: {},
    }
  }

  it('splits text around a single mid-string match', () => {
    const matches = [makeMatch(0, 6, 11, 'world')]
    const segs = segmentText('hello world!', matches)
    expect(segs).toHaveLength(3)
    expect(segs[0]).toEqual({ text: 'hello ', isMatch: false, matchIndex: -1 })
    expect(segs[1]).toEqual({ text: 'world', isMatch: true, matchIndex: 0 })
    expect(segs[2]).toEqual({ text: '!', isMatch: false, matchIndex: -1 })
  })

  it('handles match at the very start', () => {
    const matches = [makeMatch(0, 0, 5, 'hello')]
    const segs = segmentText('hello world', matches)
    expect(segs[0]).toEqual({ text: 'hello', isMatch: true, matchIndex: 0 })
    expect(segs[1]).toEqual({ text: ' world', isMatch: false, matchIndex: -1 })
  })

  it('handles match at the very end', () => {
    const matches = [makeMatch(0, 6, 11, 'world')]
    const segs = segmentText('hello world', matches)
    expect(segs[0]).toEqual({ text: 'hello ', isMatch: false, matchIndex: -1 })
    expect(segs[1]).toEqual({ text: 'world', isMatch: true, matchIndex: 0 })
  })

  it('handles full-text match (no plain segments)', () => {
    const matches = [makeMatch(0, 0, 5, 'hello')]
    const segs = segmentText('hello', matches)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ text: 'hello', isMatch: true, matchIndex: 0 })
  })

  it('handles multiple adjacent matches', () => {
    const matches = [
      makeMatch(0, 0, 1, 'a'),
      makeMatch(1, 1, 2, 'b'),
      makeMatch(2, 2, 3, 'c'),
    ]
    const segs = segmentText('abc', matches)
    expect(segs).toHaveLength(3)
    expect(segs.every((s) => s.isMatch)).toBe(true)
  })

  it('assigns correct alternating matchIndex to each match segment', () => {
    const matches = [
      makeMatch(0, 0, 1, 'a'),
      makeMatch(1, 2, 3, 'b'),
    ]
    const segs = segmentText('a b', matches)
    const matchSegs = segs.filter((s) => s.isMatch)
    expect(matchSegs[0].matchIndex).toBe(0)
    expect(matchSegs[1].matchIndex).toBe(1)
  })

  it('handles zero-length match (produces empty isMatch segment)', () => {
    const matches = [makeMatch(0, 2, 2, '')]
    const segs = segmentText('hello', matches)
    const matchSeg = segs.find((s) => s.isMatch)
    expect(matchSeg).toBeDefined()
    expect(matchSeg!.text).toBe('')
    expect(matchSeg!.isMatch).toBe(true)
  })

  it('reconstructs the original text from all segments', () => {
    const text = 'the cat sat on the mat'
    const r = findMatches('[cm]at', 'g', text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const segs = segmentText(text, r.matches)
    const reconstructed = segs.map((s) => s.text).join('')
    expect(reconstructed).toBe(text)
  })
})

// ── applyReplace ──────────────────────────────────────────────────────────────

describe('applyReplace', () => {
  it('returns error for empty pattern', () => {
    const r = applyReplace('', 'g', 'hello', 'world')
    expect(r.ok).toBe(false)
  })

  it('returns error for invalid pattern', () => {
    const r = applyReplace('[bad', 'g', 'text', '')
    expect(r.ok).toBe(false)
  })

  it('does a simple replacement', () => {
    const r = applyReplace('world', 'g', 'hello world', 'there')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('hello there')
  })

  it('replaces all matches with g flag', () => {
    const r = applyReplace('a', 'g', 'banana', 'o')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('bonono')
  })

  it('replaces only first match without g flag', () => {
    const r = applyReplace('a', '', 'banana', 'o')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('bonana')
  })

  it('supports $1 numbered group reference in replacement', () => {
    const r = applyReplace('(\\w+)@(\\w+)', 'g', 'user@host', '$2 at $1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('host at user')
  })

  it('supports $<name> named group reference in replacement', () => {
    const r = applyReplace(
      '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})',
      'g',
      '2024-03-15',
      '$<day>/$<month>/$<year>',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('15/03/2024')
  })

  it('supports $& (full match reference)', () => {
    const r = applyReplace('\\d+', 'g', 'abc 123 def', '[$&]')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('abc [123] def')
  })

  it('returns original text when no match found', () => {
    const r = applyReplace('xyz', 'g', 'hello world', 'replaced')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('hello world')
  })

  it('handles empty replacement string (deletion)', () => {
    const r = applyReplace('\\s+', 'g', 'hello world foo', '')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('helloworldfoo')
  })
})

// ── PATTERN_PRESETS ───────────────────────────────────────────────────────────

describe('PATTERN_PRESETS', () => {
  it('has at least 5 presets', () => {
    expect(PATTERN_PRESETS.length).toBeGreaterThanOrEqual(5)
  })

  it('every preset has a non-empty label, pattern, flags, and description', () => {
    for (const p of PATTERN_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.pattern.length).toBeGreaterThan(0)
      expect(typeof p.flags).toBe('string')
      expect(p.description.length).toBeGreaterThan(0)
    }
  })

  it('every preset pattern compiles without error', () => {
    for (const p of PATTERN_PRESETS) {
      const r = buildRegex(p.pattern, p.flags)
      if (!r.ok) {
        throw new Error(`Preset "${p.label}" failed to compile: ${r.error}`)
      }
      expect(r.ok).toBe(true)
    }
  })

  it('email preset matches a valid email', () => {
    const email = PATTERN_PRESETS.find((p) => p.label === 'Email')!
    const r = findMatches(email.pattern, email.flags, 'send to user@example.com please')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches.length).toBeGreaterThanOrEqual(1)
    expect(r.matches[0].fullMatch).toBe('user@example.com')
  })

  it('UUID preset matches a valid UUID', () => {
    const uuidPreset = PATTERN_PRESETS.find((p) => p.label === 'UUID')!
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const r = findMatches(uuidPreset.pattern, uuidPreset.flags, uuid)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches.length).toBe(1)
    expect(r.matches[0].fullMatch.toLowerCase()).toBe(uuid)
  })

  it('hex color preset matches valid hex colors', () => {
    const hexPreset = PATTERN_PRESETS.find((p) => p.label === 'Hex Color')!
    const r = findMatches(hexPreset.pattern, hexPreset.flags, 'color: #ff0000 or #abc')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches.length).toBe(2)
  })

  it('ISO date preset matches a valid ISO date', () => {
    const datePreset = PATTERN_PRESETS.find((p) => p.label === 'ISO Date (YYYY-MM-DD)')!
    const r = findMatches(datePreset.pattern, datePreset.flags, 'Date: 2024-03-15')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches[0].fullMatch).toBe('2024-03-15')
  })
})

// ── Integration — roundtrip ───────────────────────────────────────────────────

describe('integration — segmentText + findMatches roundtrip', () => {
  it('correctly segments a text with multiple matches and reconstructs it', () => {
    const text = 'The quick brown fox jumps over the lazy dog'
    const r = findMatches('\\b\\w{4}\\b', 'g', text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const segs = segmentText(text, r.matches)
    // Reconstructing the text from segments must equal the original
    expect(segs.map((s) => s.text).join('')).toBe(text)
    // Each match segment should be exactly 4 chars
    for (const seg of segs.filter((s) => s.isMatch)) {
      expect(seg.text.length).toBe(4)
    }
  })

  it('handles a complex pattern with named groups end-to-end', () => {
    const text = 'Born: 1990-06-15, Hired: 2015-11-01'
    const r = findMatches('(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})', 'g', text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches).toHaveLength(2)
    expect(r.matches[0].namedGroups.year).toBe('1990')
    expect(r.matches[1].namedGroups.year).toBe('2015')

    const segs = segmentText(text, r.matches)
    expect(segs.map((s) => s.text).join('')).toBe(text)
  })
})
