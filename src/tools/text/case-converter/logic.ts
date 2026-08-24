/**
 * Case Converter — pure logic (no React, no side-effects)
 *
 * Exports:
 *   tokenize              — split an identifier/phrase into lowercase word tokens
 *   convertAll            — convert input to all 14 case styles at once
 *   toCamelCase           — helloWorld
 *   toPascalCase          — HelloWorld
 *   toSnakeCase           — hello_world
 *   toScreamingSnakeCase  — HELLO_WORLD
 *   toKebabCase           — hello-world
 *   toTrainCase           — Hello-World
 *   toDotCase             — hello.world
 *   toPathCase            — hello/world
 *   toTitleCase           — Hello World (with minor-word list)
 *   toSentenceCase        — Hello world
 *   toLowerCaseWords      — hello world
 *   toUpperCaseWords      — HELLO WORLD
 *   toAlternatingCase     — hElLo WoRlD (raw text, char-level)
 *   toInverseCase         — hELLO wORLD (raw text, swap case)
 *   TITLE_MINOR_WORDS     — set of words kept lowercase in title case
 *   CONVERSION_DEFS       — ordered array of { id, label, convert } for the UI
 *   ConversionResult      — { id, label, value }
 */

// ── Tokenizer ─────────────────────────────────────────────────────────────────

/**
 * Tokenize an identifier or phrase into an array of lowercase word tokens.
 *
 * Handles:
 *   – Separator characters: space, hyphen, underscore, dot, slash, tab
 *   – camelCase/PascalCase: fooBar → [foo, bar]
 *   – Acronym runs: HTTPServer → [http, server], XMLHttpRequest → [xml, http, request]
 *   – Digit boundaries: user2Name → [user, 2, name]
 *   – Unicode letters: é, ü, etc. (via \p{L} property escapes)
 *
 * Algorithm:
 *   1. Split on separator characters.
 *   2. For each part, run a Unicode-aware regex that recognises four kinds of
 *      token within a camel/Pascal-cased run:
 *        a. Acronym prefix   — \p{Lu}+ followed by \p{Lu}\p{Ll} or \d or end
 *           e.g. 'HTTP' in HTTPServer, 'XML' in XMLHttpRequest
 *        b. PascalCase word  — optional \p{Lu} then \p{Ll}+ run
 *           e.g. 'Server', 'Http', 'Request'
 *        c. Digit run        — \d+
 *           e.g. '2' in user2Name
 *        d. Lone uppercase   — catch-all for isolated uppercase letters
 */
export function tokenize(input: string): string[] {
  if (!input.trim()) return []

  const tokens: string[] = []

  // Step 1 – split on separator chars (hyphen, underscore, dot, slash, space, tab)
  const parts = input.split(/[-_./ \t]+/).filter(Boolean)

  for (const part of parts) {
    // Step 2 – within each part, extract word tokens using Unicode-aware patterns
    const matches =
      part.match(/\p{Lu}+(?=\p{Lu}\p{Ll}|\d|$)|\p{Lu}?\p{Ll}+|\d+|\p{Lu}/gu) ??
      [part]

    for (const m of matches) {
      const lower = m.toLowerCase()
      // Skip tokens that contain no letter or digit (pure symbols, e.g. '@@@')
      if (lower && /[\p{L}\d]/u.test(m)) tokens.push(lower)
    }
  }

  return tokens
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Capitalize the first Unicode code point of a string, leave rest as-is.
 * Works for ASCII and multi-byte Unicode characters (e.g. é → É).
 */
function capitalize(word: string): string {
  if (!word) return word
  const chars = [...word]
  return chars[0].toUpperCase() + chars.slice(1).join('')
}

// ── Minor-words list for Title Case ──────────────────────────────────────────

/**
 * Words kept lowercase in Title Case unless they appear as the first or last
 * word of a title. Follows the APA / Chicago style guide conventions.
 */
export const TITLE_MINOR_WORDS: ReadonlySet<string> = new Set([
  // Articles
  'a', 'an', 'the',
  // Coordinating conjunctions
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  // Short prepositions (≤ 4 letters)
  'as', 'at', 'by', 'in', 'of', 'on', 'to', 'up',
  'via', 'per', 'off', 'out',
  'into', 'onto', 'over', 'with', 'from',
])

// ── Per-line converters (take words array, return string) ─────────────────────

/** helloWorld */
export function toCamelCase(words: string[]): string {
  if (!words.length) return ''
  return words[0] + words.slice(1).map(capitalize).join('')
}

/** HelloWorld */
export function toPascalCase(words: string[]): string {
  if (!words.length) return ''
  return words.map(capitalize).join('')
}

/** hello_world */
export function toSnakeCase(words: string[]): string {
  return words.join('_')
}

/** HELLO_WORLD */
export function toScreamingSnakeCase(words: string[]): string {
  return words.join('_').toUpperCase()
}

/** hello-world */
export function toKebabCase(words: string[]): string {
  return words.join('-')
}

/** Hello-World */
export function toTrainCase(words: string[]): string {
  return words.map(capitalize).join('-')
}

/** hello.world */
export function toDotCase(words: string[]): string {
  return words.join('.')
}

/** hello/world */
export function toPathCase(words: string[]): string {
  return words.join('/')
}

/**
 * Title Case — capitalizes all words except minor words, unless they are the
 * first or last word.
 */
export function toTitleCase(words: string[]): string {
  if (!words.length) return ''
  return words
    .map((word, i) => {
      if (i === 0 || i === words.length - 1) return capitalize(word)
      return TITLE_MINOR_WORDS.has(word) ? word : capitalize(word)
    })
    .join(' ')
}

/** Sentence case — first word capitalized, rest lowercase, joined by spaces. */
export function toSentenceCase(words: string[]): string {
  if (!words.length) return ''
  return capitalize(words.join(' '))
}

/** lowercase — words joined by spaces, all lowercase. */
export function toLowerCaseWords(words: string[]): string {
  return words.join(' ')
}

/** UPPERCASE — words joined by spaces, all uppercase. */
export function toUpperCaseWords(words: string[]): string {
  return words.join(' ').toUpperCase()
}

// ── Raw-text converters (applied to the original text, no tokenization) ───────

/**
 * aLtErNaTiNg CaSe — alternates lowercase/uppercase for each letter;
 * non-letter characters do not advance the alternation counter.
 * Starts with lowercase for the first letter.
 */
export function toAlternatingCase(text: string): string {
  let makeUpper = false
  return [...text]
    .map((ch) => {
      if (/\p{L}/u.test(ch)) {
        const result = makeUpper ? ch.toUpperCase() : ch.toLowerCase()
        makeUpper = !makeUpper
        return result
      }
      return ch
    })
    .join('')
}

/**
 * InVeRsE cAsE (swap case) — uppercase letters become lowercase, lowercase
 * become uppercase; all other characters are preserved.
 */
export function toInverseCase(text: string): string {
  return [...text]
    .map((ch) => {
      if (/\p{Lu}/u.test(ch)) return ch.toLowerCase()
      if (/\p{Ll}/u.test(ch)) return ch.toUpperCase()
      return ch
    })
    .join('')
}

// ── Multi-line processor ──────────────────────────────────────────────────────

/**
 * Apply a words-based converter to every line of the input independently.
 * Empty / whitespace-only lines are passed through as empty strings.
 */
function applyPerLine(
  input: string,
  fn: (words: string[]) => string,
): string {
  return input
    .split('\n')
    .map((line) => {
      if (!line.trim()) return ''
      const words = tokenize(line)
      return words.length ? fn(words) : ''
    })
    .join('\n')
}

/**
 * Apply a raw-text converter to every line of the input independently.
 */
function applyRawPerLine(
  input: string,
  fn: (text: string) => string,
): string {
  return input
    .split('\n')
    .map((line) => fn(line))
    .join('\n')
}

// ── Conversion definitions ────────────────────────────────────────────────────

export interface ConversionDef {
  id: string
  label: string
  convert: (input: string) => string
}

export interface ConversionResult {
  id: string
  label: string
  value: string
}

/** Ordered list of all 14 conversion definitions. */
export const CONVERSION_DEFS: readonly ConversionDef[] = [
  {
    id: 'camelCase',
    label: 'camelCase',
    convert: (s) => applyPerLine(s, toCamelCase),
  },
  {
    id: 'pascalCase',
    label: 'PascalCase',
    convert: (s) => applyPerLine(s, toPascalCase),
  },
  {
    id: 'snakeCase',
    label: 'snake_case',
    convert: (s) => applyPerLine(s, toSnakeCase),
  },
  {
    id: 'screamingSnakeCase',
    label: 'SCREAMING_SNAKE_CASE',
    convert: (s) => applyPerLine(s, toScreamingSnakeCase),
  },
  {
    id: 'kebabCase',
    label: 'kebab-case',
    convert: (s) => applyPerLine(s, toKebabCase),
  },
  {
    id: 'trainCase',
    label: 'Train-Case',
    convert: (s) => applyPerLine(s, toTrainCase),
  },
  {
    id: 'dotCase',
    label: 'dot.case',
    convert: (s) => applyPerLine(s, toDotCase),
  },
  {
    id: 'pathCase',
    label: 'path/case',
    convert: (s) => applyPerLine(s, toPathCase),
  },
  {
    id: 'titleCase',
    label: 'Title Case',
    convert: (s) => applyPerLine(s, toTitleCase),
  },
  {
    id: 'sentenceCase',
    label: 'Sentence case',
    convert: (s) => applyPerLine(s, toSentenceCase),
  },
  {
    id: 'lowerCase',
    label: 'lowercase',
    convert: (s) => applyPerLine(s, toLowerCaseWords),
  },
  {
    id: 'upperCase',
    label: 'UPPERCASE',
    convert: (s) => applyPerLine(s, toUpperCaseWords),
  },
  {
    id: 'alternatingCase',
    label: 'aLtErNaTiNg CaSe',
    convert: (s) => applyRawPerLine(s, toAlternatingCase),
  },
  {
    id: 'inverseCase',
    label: 'InVeRsE cAsE',
    convert: (s) => applyRawPerLine(s, toInverseCase),
  },
] as const

/**
 * Convert the input text to all 14 case styles at once.
 * Returns an array of ConversionResult, one per style, in the canonical order.
 */
export function convertAll(input: string): ConversionResult[] {
  return CONVERSION_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    value: input.trim() ? def.convert(input) : '',
  }))
}
