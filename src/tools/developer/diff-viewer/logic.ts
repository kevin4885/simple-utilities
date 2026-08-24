/**
 * Diff Viewer — pure logic (no React, no side-effects)
 *
 * Exports:
 *   normalizeLine        — apply whitespace/case options to a line for comparison
 *   computeIntralineDiff — char-level Myers diff between two strings → highlighted spans
 *   computeDiff          — full line-level diff (Myers), builds unified + side-by-side rows
 *
 * Algorithm: Myers O(ND) diff on lines; memory-efficient compact trace (O(D²) space).
 * Intraline: secondary Myers run on characters for changed-line pairs.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum lines per input before we refuse to diff. */
export const MAX_LINES = 20_000

/**
 * Maximum edit-distance steps in the Myers forward pass.
 * If the diff exceeds this, we fall back to "delete all / insert all" and set
 * `fallback: true` in the result so the UI can show a warning banner.
 *
 * Memory: compact trace uses ≈ D²/2 numbers.  At D = 2000 that's ~2 M numbers
 * (≈ 16 MB), well within browser limits.  Time: O(D²) non-snake ops + O(N+M)
 * snake ops — both very fast for D ≤ 2000.
 */
export const MAX_DIFF_D = 2_000

/** Lines longer than this skip intraline highlighting (avoid slow char-level Myers). */
export const MAX_CHARS_INTRALINE = 2_000

// ── Types ─────────────────────────────────────────────────────────────────────

/** Options that affect the diff comparison (display always uses original text). */
export interface DiffOptions {
  /** Trim and collapse whitespace before comparing lines. */
  ignoreWhitespace: boolean
  /** Lower-case before comparing lines. */
  ignoreCase: boolean
}

/** A [start, end) span of characters within a single line string. */
export interface IntralineSpan {
  /** Inclusive start index (code-unit). */
  start: number
  /** Exclusive end index (code-unit). */
  end: number
}

/** A row in the unified view. */
export interface UnifiedRow {
  /** 'context' = equal, 'delete' = removed, 'insert' = added */
  type: 'context' | 'delete' | 'insert'
  /** Original (non-normalized) line text. */
  text: string
  /** 1-based line number in the original file; null for pure-insert rows. */
  lineA: number | null
  /** 1-based line number in the modified file; null for pure-delete rows. */
  lineB: number | null
  /**
   * Intraline char-level changed spans within `text`.
   * Non-empty only for delete/insert rows that are part of a changed pair.
   */
  intralineSpans: IntralineSpan[]
}

/** A row in the side-by-side view. */
export interface SideBySideRow {
  /**
   * 'context'    = unchanged line (both sides identical)
   * 'changed'    = line was modified (delete + matching insert)
   * 'delete-only'= line was removed (no matching insert)
   * 'insert-only'= line was added (no matching delete)
   */
  type: 'context' | 'changed' | 'delete-only' | 'insert-only'
  /** Original line text; null for insert-only rows. */
  textA: string | null
  /** Modified line text; null for delete-only rows. */
  textB: string | null
  lineA: number | null
  lineB: number | null
  /** Intraline spans in textA (non-empty for 'changed' rows). */
  intralineSpansA: IntralineSpan[]
  /** Intraline spans in textB (non-empty for 'changed' rows). */
  intralineSpansB: IntralineSpan[]
}

/** Aggregate statistics from the diff. */
export interface DiffStats {
  additions: number
  deletions: number
}

export type DiffResult =
  | {
      ok: true
      unified: UnifiedRow[]
      sideBySide: SideBySideRow[]
      stats: DiffStats
      /** True when the diff exceeded MAX_DIFF_D and fell back to all-delete/all-insert. */
      fallback: boolean
    }
  | { ok: false; error: string }

// ── Internal: raw diff operation ──────────────────────────────────────────────

interface DiffOp {
  kind: 'equal' | 'delete' | 'insert'
  text: string
}

// ── normalizeLine ─────────────────────────────────────────────────────────────

/**
 * Normalize a line string for comparison purposes.
 * The original (un-normalized) text is always used for display.
 */
export function normalizeLine(line: string, opts: DiffOptions): string {
  let s = line
  if (opts.ignoreWhitespace) {
    s = s.trim().replace(/\s+/g, ' ')
  }
  if (opts.ignoreCase) {
    s = s.toLowerCase()
  }
  return s
}

// ── Internal: Myers diff ──────────────────────────────────────────────────────

/**
 * Myers O(ND) diff on two string arrays.
 *
 * @param a       Original sequence (display text).
 * @param b       Modified sequence (display text).
 * @param normFn  Function applied to each element before comparison (normalization).
 *                Pass `s => s` for no normalization.
 *
 * Memory: compact trace — trace[d] holds only d+1 numbers (x-coords for the d+1
 * valid diagonals at step d), giving O(D²/2) total.
 *
 * Fallback: if edit distance exceeds MAX_DIFF_D, returns all-delete + all-insert.
 */
function myersDiff(
  a: string[],
  b: string[],
  normFn: (s: string) => string,
): { ops: DiffOp[]; fallback: boolean } {
  const n = a.length
  const m = b.length

  if (n === 0 && m === 0) return { ops: [], fallback: false }
  if (n === 0) return { ops: b.map(text => ({ kind: 'insert', text })), fallback: false }
  if (m === 0) return { ops: a.map(text => ({ kind: 'delete', text })), fallback: false }

  // Normalized versions for comparison
  const an = a.map(normFn)
  const bn = b.map(normFn)

  const max = n + m
  const maxD = Math.min(max, MAX_DIFF_D)

  // Full-size mutable V array for the forward pass.
  // v[k + max] = furthest x on diagonal k.
  // V[k-1] and V[k+1] always carry values from step d-1 because k±1 have opposite parity.
  const v = new Array<number>(2 * max + 2).fill(0)

  // Compact trace: trace[d] has d+1 numbers.
  // trace[d][(k + d) >> 1] = V[k] after completing step d.
  // Index formula: i = (k + d) / 2 (valid since k and d share parity).
  const trace: number[][] = []

  let done = false

  outer: for (let d = 0; d <= maxD; d++) {
    // Allocate compact snapshot for this step (we fill it as we go).
    const snap = new Array<number>(d + 1)

    for (let k = -d; k <= d; k += 2) {
      const ki = k + max
      let x: number
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        x = v[ki + 1] // came from diagonal k+1 (insert: y increases)
      } else {
        x = v[ki - 1] + 1 // came from diagonal k-1 (delete: x increases)
      }
      let y = x - k
      // Extend snake along equal elements
      while (x < n && y < m && an[x] === bn[y]) {
        x++
        y++
      }
      v[ki] = x
      snap[(k + d) >> 1] = x

      if (x >= n && y >= m) {
        trace.push(snap)
        done = true
        break outer
      }
    }
    trace.push(snap)
  }

  // ── Fallback: diff too complex ────────────────────────────────────────────
  if (!done) {
    const ops: DiffOp[] = [
      ...a.map((text): DiffOp => ({ kind: 'delete', text })),
      ...b.map((text): DiffOp => ({ kind: 'insert', text })),
    ]
    return { ops, fallback: true }
  }

  // ── Backtrack through trace to reconstruct the edit script ───────────────
  const result: DiffOp[] = []
  let x = n
  let y = m

  for (let d = trace.length - 1; d >= 0; d--) {
    const k = x - y

    if (d === 0) {
      // Remaining snake from (0,0): all equal
      while (x > 0) {
        x--
        y--
        result.unshift({ kind: 'equal', text: a[x] })
      }
      break
    }

    const prevSnap = trace[d - 1]
    //
    // Index of k in trace[d]:   i = (k + d) / 2
    // Index of k-1 in trace[d-1]:  (k-1 + (d-1)) / 2 = (k+d-2)/2 = i-1
    // Index of k+1 in trace[d-1]:  (k+1 + (d-1)) / 2 = (k+d)/2   = i
    //
    const i = (k + d) >> 1

    // Determine if the move was an insert (came from k+1) or delete (came from k-1).
    // Mirrors the forward-pass condition, using prevSnap for V_{d-1}[k±1].
    const vKminus1 = i > 0 ? prevSnap[i - 1] : -1
    const vKplus1 = i < d ? prevSnap[i] : -1

    let prevK: number
    if (i === 0 || (i !== d && vKminus1 < vKplus1)) {
      prevK = k + 1 // insert
    } else {
      prevK = k - 1 // delete
    }

    const prevX = prevK === k + 1 ? prevSnap[i] : prevSnap[i - 1]
    const prevY = prevX - prevK

    // Snake segment: from (snakeStartX, snakeStartY) to (x, y)
    const snakeStartX = prevK === k - 1 ? prevX + 1 : prevX

    while (x > snakeStartX) {
      x--
      y--
      result.unshift({ kind: 'equal', text: a[x] })
    }

    // The single edit move
    if (prevK === k - 1) {
      result.unshift({ kind: 'delete', text: a[prevX] })
    } else {
      result.unshift({ kind: 'insert', text: b[prevY] })
    }

    x = prevX
    y = prevY
  }

  return { ops: result, fallback: false }
}

// ── computeIntralineDiff ──────────────────────────────────────────────────────

/**
 * Run a char-level Myers diff between two line strings and return the changed
 * spans in each.  Spans cover only the *differing* characters (equal chars
 * produce no span).
 *
 * Returns empty spans for either string longer than MAX_CHARS_INTRALINE, or
 * when the strings are identical.
 */
export function computeIntralineDiff(
  a: string,
  b: string,
): { spansA: IntralineSpan[]; spansB: IntralineSpan[] } {
  if (a === b) return { spansA: [], spansB: [] }
  if (a.length > MAX_CHARS_INTRALINE || b.length > MAX_CHARS_INTRALINE) {
    return { spansA: [], spansB: [] }
  }

  // Split into Unicode code points (handles emoji / surrogate pairs correctly).
  const aCodePoints = [...a]
  const bCodePoints = [...b]

  // Build offset tables: codePointOffsets[i] = code-unit start of code point i.
  const aOffsets = buildCodePointOffsets(aCodePoints)
  const bOffsets = buildCodePointOffsets(bCodePoints)

  const { ops } = myersDiff(aCodePoints, bCodePoints, s => s)

  const spansA: IntralineSpan[] = []
  const spansB: IntralineSpan[] = []
  let ai = 0 // code-point index in a
  let bi = 0 // code-point index in b

  for (const op of ops) {
    if (op.kind === 'equal') {
      ai++
      bi++
    } else if (op.kind === 'delete') {
      const start = aOffsets[ai]
      const end = aOffsets[ai] + op.text.length
      const last = spansA[spansA.length - 1]
      if (last && last.end === start) {
        last.end = end // merge adjacent spans
      } else {
        spansA.push({ start, end })
      }
      ai++
    } else {
      const start = bOffsets[bi]
      const end = bOffsets[bi] + op.text.length
      const last = spansB[spansB.length - 1]
      if (last && last.end === start) {
        last.end = end
      } else {
        spansB.push({ start, end })
      }
      bi++
    }
  }

  return { spansA, spansB }
}

/** Build an array mapping code-point index → code-unit start offset. */
function buildCodePointOffsets(codePoints: string[]): number[] {
  const offsets: number[] = new Array(codePoints.length)
  let pos = 0
  for (let i = 0; i < codePoints.length; i++) {
    offsets[i] = pos
    pos += codePoints[i].length
  }
  return offsets
}

// ── Internal: build unified / side-by-side rows ───────────────────────────────

function buildRows(ops: DiffOp[], skipIntralinePairing = false): {
  unified: UnifiedRow[]
  sideBySide: SideBySideRow[]
} {
  const unified: UnifiedRow[] = []
  const sideBySide: SideBySideRow[] = []

  let la = 1 // next line number in original (A)
  let lb = 1 // next line number in modified (B)
  let oi = 0 // current index in ops

  while (oi < ops.length) {
    // ── Equal (context) line ──────────────────────────────────────────────
    if (ops[oi].kind === 'equal') {
      const text = ops[oi].text
      unified.push({ type: 'context', text, lineA: la, lineB: lb, intralineSpans: [] })
      sideBySide.push({
        type: 'context',
        textA: text,
        textB: text,
        lineA: la,
        lineB: lb,
        intralineSpansA: [],
        intralineSpansB: [],
      })
      la++
      lb++
      oi++
      continue
    }

    // ── Group of consecutive deletes then inserts ─────────────────────────
    // Collect all consecutive deletes
    const delGroup: Array<{ text: string; la: number }> = []
    while (oi < ops.length && ops[oi].kind === 'delete') {
      delGroup.push({ text: ops[oi].text, la: la++ })
      oi++
    }
    // Collect all consecutive inserts (immediately following the deletes)
    const insGroup: Array<{ text: string; lb: number }> = []
    while (oi < ops.length && ops[oi].kind === 'insert') {
      insGroup.push({ text: ops[oi].text, lb: lb++ })
      oi++
    }

    // Precompute intraline diffs for each delete/insert pair
    // (skipped in fallback mode to avoid misleading pairings across unrelated lines)
    const pairCount = skipIntralinePairing ? 0 : Math.min(delGroup.length, insGroup.length)
    const intralinePairs: Array<{ spansA: IntralineSpan[]; spansB: IntralineSpan[] }> = []
    for (let p = 0; p < pairCount; p++) {
      intralinePairs.push(computeIntralineDiff(delGroup[p].text, insGroup[p].text))
    }

    // Unified view: deletes first, then inserts
    for (let p = 0; p < delGroup.length; p++) {
      unified.push({
        type: 'delete',
        text: delGroup[p].text,
        lineA: delGroup[p].la,
        lineB: null,
        intralineSpans: p < pairCount ? intralinePairs[p].spansA : [],
      })
    }
    for (let p = 0; p < insGroup.length; p++) {
      unified.push({
        type: 'insert',
        text: insGroup[p].text,
        lineA: null,
        lineB: insGroup[p].lb,
        intralineSpans: p < pairCount ? intralinePairs[p].spansB : [],
      })
    }

    // Side-by-side view: paired changed rows, then surplus on one side
    for (let p = 0; p < pairCount; p++) {
      sideBySide.push({
        type: 'changed',
        textA: delGroup[p].text,
        textB: insGroup[p].text,
        lineA: delGroup[p].la,
        lineB: insGroup[p].lb,
        intralineSpansA: intralinePairs[p].spansA,
        intralineSpansB: intralinePairs[p].spansB,
      })
    }
    for (let p = pairCount; p < delGroup.length; p++) {
      sideBySide.push({
        type: 'delete-only',
        textA: delGroup[p].text,
        textB: null,
        lineA: delGroup[p].la,
        lineB: null,
        intralineSpansA: [],
        intralineSpansB: [],
      })
    }
    for (let p = pairCount; p < insGroup.length; p++) {
      sideBySide.push({
        type: 'insert-only',
        textA: null,
        textB: insGroup[p].text,
        lineA: null,
        lineB: insGroup[p].lb,
        intralineSpansA: [],
        intralineSpansB: [],
      })
    }
  }

  return { unified, sideBySide }
}

// ── computeDiff ───────────────────────────────────────────────────────────────

/**
 * Compute a line-level diff between `original` and `modified`.
 *
 * Options affect the *comparison* only — display always shows the original text.
 *
 * Returns structured rows for both the unified and side-by-side views, plus
 * aggregate stats.  Includes `fallback: true` when the diff exceeded MAX_DIFF_D
 * steps and fell back to a non-minimal (but correct) all-delete/all-insert diff.
 */
export function computeDiff(
  original: string,
  modified: string,
  options: DiffOptions,
): DiffResult {
  // Treat a truly empty input as having zero lines (not one empty line).
  // This keeps 'empty vs X' symmetric: no deletions when original is blank.
  const aLines = original === '' ? [] : original.split('\n')
  const bLines = modified === '' ? [] : modified.split('\n')

  if (aLines.length > MAX_LINES || bLines.length > MAX_LINES) {
    return {
      ok: false,
      error:
        `Input too large: each input must be ${MAX_LINES.toLocaleString()} lines or fewer. ` +
        `Original has ${aLines.length.toLocaleString()} lines; ` +
        `modified has ${bLines.length.toLocaleString()} lines.`,
    }
  }

  const normFn = (line: string) => normalizeLine(line, options)
  const { ops, fallback } = myersDiff(aLines, bLines, normFn)

  // In fallback mode, skip intraline pairing — the pairs are semantically arbitrary
  // (all-delete + all-insert, not grouped by edit proximity), so highlighting would mislead.
  const { unified, sideBySide } = buildRows(ops, fallback)

  const additions = unified.filter(r => r.type === 'insert').length
  const deletions = unified.filter(r => r.type === 'delete').length

  return {
    ok: true,
    unified,
    sideBySide,
    stats: { additions, deletions },
    fallback,
  }
}
