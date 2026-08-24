/**
 * Lorem Ipsum Generator — pure logic (no React, no side-effects)
 *
 * Exports:
 *   mulberry32          — seedable 32-bit PRNG (injectable for deterministic tests)
 *   generateLoremIpsum  — main generation function
 *   countWords          — count whitespace-separated words in a string
 *   countChars          — count Unicode characters in a string
 *   LOREM_WORDS         — the traditional lorem ipsum word list
 *
 * Generation rules:
 *   – Paragraphs: 3–7 sentences each
 *   – Sentences: 6–14 words, first word capitalized, ends with "."
 *   – Commas: ~25% chance after word 3–(n-2) of a sentence for realism
 *   – Classic opening: first sentence is always
 *     "Lorem ipsum dolor sit amet, consectetur adipiscing elit."
 */

// ── PRNG ──────────────────────────────────────────────────────────────────────

/**
 * Mulberry32 — a fast, high-quality 32-bit seedable PRNG.
 * Returns a function `rng()` that produces a float in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return function rng(): number {
    s += 0x6d2b79f5
    let z = s
    z = Math.imul(z ^ (z >>> 15), z | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    z = (z ^ (z >>> 14)) >>> 0
    return z / 0x100000000
  }
}

// ── Word list ─────────────────────────────────────────────────────────────────

/**
 * Traditional lorem ipsum word list, derived from Cicero's "de Finibus Bonorum et Malorum".
 */
export const LOREM_WORDS: readonly string[] = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
  'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
  'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint',
  'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia',
  'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum', 'perspiciatis', 'unde',
  'omnis', 'iste', 'natus', 'error', 'voluptatem', 'accusantium', 'doloremque',
  'laudantium', 'totam', 'rem', 'aperiam', 'eaque', 'ipsa', 'quae', 'ab', 'illo',
  'inventore', 'veritatis', 'quasi', 'architecto', 'beatae', 'vitae', 'dicta',
  'explicabo', 'aspernatur', 'aut', 'odit', 'fugit', 'consequuntur', 'magni',
  'dolores', 'eos', 'ratione', 'sequi', 'nesciunt', 'neque', 'porro', 'quisquam',
  'dolorem', 'adipisci', 'numquam', 'eius', 'modi', 'tempora', 'incidunt', 'magnam',
  'quaerat', 'voluptas', 'minima', 'nostrum', 'exercitationem', 'ullam', 'corporis',
  'suscipit', 'laboriosam', 'quidem', 'rerum', 'facilis', 'expedita', 'distinctio',
  'libero', 'tempore', 'cum', 'soluta', 'nobis', 'eligendi', 'optio', 'cumque',
  'impedit', 'quos', 'minus', 'maxime', 'placeat', 'facere', 'possimus', 'voluptatum',
  'assumenda', 'repellendus', 'temporibus', 'autem', 'quibusdam', 'officiis',
  'debitis', 'reiciendis', 'voluptatibus', 'maiores', 'alias', 'perferendis',
  'doloribus', 'asperiores', 'repellat', 'blanditiis', 'praesentium',
]

// Classic opening sentence (without trailing period — added by the sentence builder)
const CLASSIC_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'

// ── Sentence & paragraph bounds ───────────────────────────────────────────────

export const SENTENCE_MIN_WORDS = 6
export const SENTENCE_MAX_WORDS = 14
export const PARA_MIN_SENTENCES = 3
export const PARA_MAX_SENTENCES = 7

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Integer in [min, max] inclusive. */
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** Pick a random element from an array. */
function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

/** Capitalize the first character of a string. */
function capitalize(s: string): string {
  if (!s) return s
  return s[0].toUpperCase() + s.slice(1)
}

// ── Core generators ───────────────────────────────────────────────────────────

/**
 * Generate one sentence of lorem ipsum text.
 *
 * @param rng  - PRNG function
 * @param wordCount - number of words (6–14 recommended)
 */
function buildSentence(rng: () => number, wordCount: number): string {
  const words: string[] = []
  for (let i = 0; i < wordCount; i++) {
    words.push(pick(rng, LOREM_WORDS))
  }

  // Insert commas: ~25% chance on eligible positions (index 2 through n-3, i.e. not
  // the first two words or the last two words), at most one comma per sentence.
  const eligiblePositions: number[] = []
  for (let i = 2; i <= wordCount - 3; i++) {
    eligiblePositions.push(i)
  }
  if (eligiblePositions.length > 0 && rng() < 0.25) {
    const commaIdx = eligiblePositions[Math.floor(rng() * eligiblePositions.length)]
    words[commaIdx] = words[commaIdx] + ','
  }

  return capitalize(words.join(' ')) + '.'
}

/**
 * Generate N sentences as an array of strings.
 *
 * @param rng          - PRNG function
 * @param count        - number of sentences to generate
 * @param classicStart - if true, first sentence is the classic opening
 */
function buildSentences(
  rng: () => number,
  count: number,
  classicStart: boolean,
): string[] {
  const sentences: string[] = []
  for (let i = 0; i < count; i++) {
    if (i === 0 && classicStart) {
      sentences.push(CLASSIC_OPENING)
    } else {
      const len = randInt(rng, SENTENCE_MIN_WORDS, SENTENCE_MAX_WORDS)
      sentences.push(buildSentence(rng, len))
    }
  }
  return sentences
}

/**
 * Generate N paragraphs as an array of string arrays (each inner array is the
 * sentences of one paragraph).
 *
 * @param rng          - PRNG function
 * @param count        - number of paragraphs to generate
 * @param classicStart - if true, first sentence of the first paragraph is the classic opening
 */
function buildParagraphs(
  rng: () => number,
  count: number,
  classicStart: boolean,
): string[][] {
  const paragraphs: string[][] = []
  let firstSentence = true
  for (let p = 0; p < count; p++) {
    const sentCount = randInt(rng, PARA_MIN_SENTENCES, PARA_MAX_SENTENCES)
    const sentences: string[] = []
    for (let s = 0; s < sentCount; s++) {
      if (firstSentence && classicStart) {
        sentences.push(CLASSIC_OPENING)
        firstSentence = false
      } else {
        firstSentence = false
        const len = randInt(rng, SENTENCE_MIN_WORDS, SENTENCE_MAX_WORDS)
        sentences.push(buildSentence(rng, len))
      }
    }
    paragraphs.push(sentences)
  }
  return paragraphs
}

// ── Output format ─────────────────────────────────────────────────────────────

export type GenerateUnit = 'paragraphs' | 'sentences' | 'words'
export type OutputFormat = 'plain' | 'html-p' | 'html-ul'

export interface GenerateOptions {
  unit: GenerateUnit
  count: number
  classicStart: boolean
  format: OutputFormat
  /** Injectable RNG factory — defaults to mulberry32(Date.now()) in production. */
  rng: () => number
}

/**
 * Main generation entry point.
 *
 * Returns the generated text as a string in the requested format.
 */
export function generateLoremIpsum(opts: GenerateOptions): string {
  const { unit, count, classicStart, format, rng } = opts

  if (count <= 0) return ''

  if (unit === 'words') {
    // Generate a flat list of words, then reassemble into plain/HTML sentences/paragraphs
    // but respecting the exact word count.
    //
    // Note: for the words unit, classicStart seeds the word pool with the first 8
    // classic words (lorem ipsum dolor sit amet consectetur adipiscing elit) rather
    // than inserting the exact "Lorem ipsum dolor sit amet, consectetur adipiscing elit."
    // sentence. This is intentional: the words unit guarantees an exact count; the
    // comma and capitalization are applied by chunkWordsIntoParagraphs, so the output
    // starts with those words but not necessarily with the verbatim classic phrase.
    const words: string[] = []
    if (classicStart) {
      // Classic opening provides 8 words: lorem ipsum dolor sit amet consectetur adipiscing elit
      const classicWords = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit']
      for (const w of classicWords) {
        if (words.length >= count) break
        words.push(w)
      }
    }
    while (words.length < count) {
      words.push(pick(rng, LOREM_WORDS))
    }
    const finalWords = words.slice(0, count)

    if (format === 'plain') {
      // Group into informal sentences/paragraphs visually, but expose raw text
      return formatWordsAsPlain(rng, finalWords)
    } else if (format === 'html-p') {
      return formatWordsAsHtmlP(rng, finalWords)
    } else {
      return formatWordsAsHtmlUl(rng, finalWords)
    }
  }

  if (unit === 'sentences') {
    const sentences = buildSentences(rng, count, classicStart)

    if (format === 'plain') {
      // Group sentences into paragraphs (3–7 sentences each) for readability
      return groupSentencesAsPlain(rng, sentences)
    } else if (format === 'html-p') {
      return groupSentencesAsHtmlP(rng, sentences)
    } else {
      return groupSentencesAsHtmlUl(sentences)
    }
  }

  // unit === 'paragraphs'
  const paragraphs = buildParagraphs(rng, count, classicStart)

  if (format === 'plain') {
    return paragraphs.map((sents) => sents.join(' ')).join('\n\n')
  } else if (format === 'html-p') {
    return paragraphs.map((sents) => `<p>${sents.join(' ')}</p>`).join('\n')
  } else {
    // html-ul: each paragraph becomes one <li>
    const items = paragraphs.map((sents) => `  <li>${sents.join(' ')}</li>`)
    return `<ul>\n${items.join('\n')}\n</ul>`
  }
}

// ── Word-unit formatting helpers ──────────────────────────────────────────────

/**
 * Take a flat list of words and render them as plain text sentences grouped
 * into paragraphs.  Sentence lengths are drawn from the RNG; when words run
 * out the last sentence is whatever remains (minimum 1 word).
 */
function formatWordsAsPlain(rng: () => number, words: string[]): string {
  const paragraphs = chunkWordsIntoParagraphs(rng, words)
  return paragraphs.join('\n\n')
}

function formatWordsAsHtmlP(rng: () => number, words: string[]): string {
  const paragraphs = chunkWordsIntoParagraphs(rng, words)
  return paragraphs.map((p) => `<p>${p}</p>`).join('\n')
}

function formatWordsAsHtmlUl(rng: () => number, words: string[]): string {
  const paragraphs = chunkWordsIntoParagraphs(rng, words)
  const items = paragraphs.map((p) => `  <li>${p}</li>`)
  return `<ul>\n${items.join('\n')}\n</ul>`
}

/**
 * Chunk a flat word array into paragraph strings. Each paragraph has 3–7
 * sentences; each sentence consumes 6–14 words from the pool. The last chunk
 * may be smaller.
 */
function chunkWordsIntoParagraphs(rng: () => number, words: string[]): string[] {
  const paragraphs: string[] = []
  let pos = 0
  while (pos < words.length) {
    const sentCount = randInt(rng, PARA_MIN_SENTENCES, PARA_MAX_SENTENCES)
    const sentences: string[] = []
    for (let s = 0; s < sentCount && pos < words.length; s++) {
      const remaining = words.length - pos
      const maxLen = Math.min(SENTENCE_MAX_WORDS, remaining)
      const len = remaining <= SENTENCE_MIN_WORDS ? remaining : randInt(rng, SENTENCE_MIN_WORDS, maxLen)
      const chunk = words.slice(pos, pos + len)
      pos += len
      const eligible = chunk.slice(2, chunk.length - 2)
      if (eligible.length > 0 && rng() < 0.25) {
        const ci = 2 + Math.floor(rng() * eligible.length)
        chunk[ci] = chunk[ci] + ','
      }
      sentences.push(capitalize(chunk.join(' ')) + '.')
    }
    paragraphs.push(sentences.join(' '))
  }
  return paragraphs
}

// ── Sentence-unit grouping helpers ────────────────────────────────────────────

function groupSentencesAsPlain(rng: () => number, sentences: string[]): string {
  const groups = groupSentencesIntoParagraphs(rng, sentences)
  return groups.map((g) => g.join(' ')).join('\n\n')
}

function groupSentencesAsHtmlP(rng: () => number, sentences: string[]): string {
  const groups = groupSentencesIntoParagraphs(rng, sentences)
  return groups.map((g) => `<p>${g.join(' ')}</p>`).join('\n')
}

function groupSentencesAsHtmlUl(sentences: string[]): string {
  const items = sentences.map((s) => `  <li>${s}</li>`)
  return `<ul>\n${items.join('\n')}\n</ul>`
}

/**
 * Group a flat sentence array into paragraph groups of 3–7 sentences each.
 * The last group gets whatever sentences remain.
 */
function groupSentencesIntoParagraphs(rng: () => number, sentences: string[]): string[][] {
  const groups: string[][] = []
  let pos = 0
  while (pos < sentences.length) {
    const size = randInt(rng, PARA_MIN_SENTENCES, PARA_MAX_SENTENCES)
    groups.push(sentences.slice(pos, pos + size))
    pos += size
  }
  return groups
}

// ── Count helpers ─────────────────────────────────────────────────────────────

/**
 * Count whitespace-separated words in a string.
 * Strips HTML tags first so counts reflect visible text.
 */
export function countWords(text: string): number {
  if (!text.trim()) return 0
  const stripped = text.replace(/<[^>]*>/g, ' ')
  return stripped.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Count Unicode characters (code points) in a string,
 * excluding HTML tags.
 */
export function countChars(text: string): number {
  if (!text) return 0
  const stripped = text.replace(/<[^>]*>/g, '')
  return [...stripped].length
}
