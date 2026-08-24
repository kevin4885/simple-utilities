/**
 * Case Converter — logic tests
 *
 * Tests cover:
 *   – tokenize: edge cases (acronyms, digits, mixed separators, unicode, empty)
 *   – each conversion style with known expected outputs
 *   – Title Case minor-word list behavior
 *   – multi-line handling (per-line independence)
 *   – alternating case / inverse (swap) case
 *   – convertAll helper
 */

import { describe, expect, it } from 'vitest'
import {
  tokenize,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  toScreamingSnakeCase,
  toKebabCase,
  toTrainCase,
  toDotCase,
  toPathCase,
  toTitleCase,
  toSentenceCase,
  toLowerCaseWords,
  toUpperCaseWords,
  toAlternatingCase,
  toInverseCase,
  TITLE_MINOR_WORDS,
  CONVERSION_DEFS,
  convertAll,
} from './logic'

// ── tokenize ──────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([])
  })

  it('returns empty array for whitespace-only string', () => {
    expect(tokenize('   ')).toEqual([])
  })

  it('splits plain words on spaces', () => {
    expect(tokenize('hello world')).toEqual(['hello', 'world'])
  })

  it('splits on underscores', () => {
    expect(tokenize('hello_world')).toEqual(['hello', 'world'])
  })

  it('splits on hyphens', () => {
    expect(tokenize('hello-world')).toEqual(['hello', 'world'])
  })

  it('splits on dots', () => {
    expect(tokenize('hello.world')).toEqual(['hello', 'world'])
  })

  it('splits on slashes', () => {
    expect(tokenize('hello/world')).toEqual(['hello', 'world'])
  })

  it('handles camelCase', () => {
    expect(tokenize('fooBar')).toEqual(['foo', 'bar'])
  })

  it('handles PascalCase', () => {
    expect(tokenize('FooBar')).toEqual(['foo', 'bar'])
  })

  it('handles acronym prefix — HTTPServer', () => {
    expect(tokenize('HTTPServer')).toEqual(['http', 'server'])
  })

  it('handles acronym prefix — XMLHttpRequest', () => {
    expect(tokenize('XMLHttpRequest')).toEqual(['xml', 'http', 'request'])
  })

  it('handles consecutive acronyms — myURLParser', () => {
    expect(tokenize('myURLParser')).toEqual(['my', 'url', 'parser'])
  })

  it('handles digit boundaries — user2Name', () => {
    expect(tokenize('user2Name')).toEqual(['user', '2', 'name'])
  })

  it('handles digit run at start', () => {
    expect(tokenize('404notFound')).toEqual(['404', 'not', 'found'])
  })

  it('handles digit run at end', () => {
    expect(tokenize('level3')).toEqual(['level', '3'])
  })

  it('handles mixed separators', () => {
    expect(tokenize('foo-bar_baz.qux')).toEqual(['foo', 'bar', 'baz', 'qux'])
  })

  it('handles leading/trailing separators', () => {
    expect(tokenize('_foo_bar_')).toEqual(['foo', 'bar'])
  })

  it('handles Unicode letters — é and ü', () => {
    // résumé and über should tokenize as single tokens (no split mid-accented word)
    expect(tokenize('résumé')).toEqual(['résumé'])
    expect(tokenize('über')).toEqual(['über'])
  })

  it('handles Unicode mixed — caféMenu', () => {
    expect(tokenize('caféMenu')).toEqual(['café', 'menu'])
  })

  it('handles single word', () => {
    expect(tokenize('hello')).toEqual(['hello'])
  })

  it('handles ALLCAPS single token', () => {
    expect(tokenize('HTTP')).toEqual(['http'])
  })

  it('handles multiple separators together', () => {
    expect(tokenize('foo--bar__baz')).toEqual(['foo', 'bar', 'baz'])
  })

  it('handles deeply mixed — getHTTPSResponseCode', () => {
    expect(tokenize('getHTTPSResponseCode')).toEqual(['get', 'https', 'response', 'code'])
  })
})

// ── Case converters (words-based) ─────────────────────────────────────────────

describe('toCamelCase', () => {
  it('basic two words', () => {
    expect(toCamelCase(['hello', 'world'])).toBe('helloWorld')
  })

  it('single word', () => {
    expect(toCamelCase(['hello'])).toBe('hello')
  })

  it('empty array', () => {
    expect(toCamelCase([])).toBe('')
  })

  it('three words', () => {
    expect(toCamelCase(['get', 'user', 'name'])).toBe('getUserName')
  })

  it('digit tokens', () => {
    expect(toCamelCase(['user', '2', 'name'])).toBe('user2Name')
  })
})

describe('toPascalCase', () => {
  it('basic two words', () => {
    expect(toPascalCase(['hello', 'world'])).toBe('HelloWorld')
  })

  it('single word', () => {
    expect(toPascalCase(['hello'])).toBe('Hello')
  })

  it('empty array', () => {
    expect(toPascalCase([])).toBe('')
  })

  it('http server', () => {
    expect(toPascalCase(['http', 'server'])).toBe('HttpServer')
  })
})

describe('toSnakeCase', () => {
  it('basic', () => {
    expect(toSnakeCase(['hello', 'world'])).toBe('hello_world')
  })

  it('single word', () => {
    expect(toSnakeCase(['hello'])).toBe('hello')
  })

  it('empty array', () => {
    expect(toSnakeCase([])).toBe('')
  })

  it('three words', () => {
    expect(toSnakeCase(['get', 'user', 'name'])).toBe('get_user_name')
  })
})

describe('toScreamingSnakeCase', () => {
  it('basic', () => {
    expect(toScreamingSnakeCase(['hello', 'world'])).toBe('HELLO_WORLD')
  })

  it('single word', () => {
    expect(toScreamingSnakeCase(['max'])).toBe('MAX')
  })

  it('empty array', () => {
    expect(toScreamingSnakeCase([])).toBe('')
  })
})

describe('toKebabCase', () => {
  it('basic', () => {
    expect(toKebabCase(['hello', 'world'])).toBe('hello-world')
  })

  it('single word', () => {
    expect(toKebabCase(['hello'])).toBe('hello')
  })

  it('empty array', () => {
    expect(toKebabCase([])).toBe('')
  })
})

describe('toTrainCase', () => {
  it('basic', () => {
    expect(toTrainCase(['hello', 'world'])).toBe('Hello-World')
  })

  it('single word', () => {
    expect(toTrainCase(['hello'])).toBe('Hello')
  })

  it('empty array', () => {
    expect(toTrainCase([])).toBe('')
  })
})

describe('toDotCase', () => {
  it('basic', () => {
    expect(toDotCase(['hello', 'world'])).toBe('hello.world')
  })

  it('single word', () => {
    expect(toDotCase(['hello'])).toBe('hello')
  })

  it('empty array', () => {
    expect(toDotCase([])).toBe('')
  })
})

describe('toPathCase', () => {
  it('basic', () => {
    expect(toPathCase(['hello', 'world'])).toBe('hello/world')
  })

  it('single word', () => {
    expect(toPathCase(['hello'])).toBe('hello')
  })

  it('empty array', () => {
    expect(toPathCase([])).toBe('')
  })
})

// ── Title Case ────────────────────────────────────────────────────────────────

describe('toTitleCase', () => {
  it('basic capitalization', () => {
    expect(toTitleCase(['the', 'quick', 'brown', 'fox'])).toBe('The Quick Brown Fox')
  })

  it('first word always capitalized even if minor', () => {
    expect(toTitleCase(['the', 'end'])).toBe('The End')
    expect(toTitleCase(['a', 'new', 'hope'])).toBe('A New Hope')
  })

  it('last word always capitalized even if minor', () => {
    expect(toTitleCase(['all', 'of', 'the', 'above', 'and'])).toBe('All of the Above And')
  })

  it('minor words in middle stay lowercase', () => {
    expect(toTitleCase(['war', 'and', 'peace'])).toBe('War and Peace')
    expect(toTitleCase(['lord', 'of', 'the', 'rings'])).toBe('Lord of the Rings')
  })

  it('TITLE_MINOR_WORDS set contains expected words', () => {
    expect(TITLE_MINOR_WORDS.has('a')).toBe(true)
    expect(TITLE_MINOR_WORDS.has('an')).toBe(true)
    expect(TITLE_MINOR_WORDS.has('the')).toBe(true)
    expect(TITLE_MINOR_WORDS.has('and')).toBe(true)
    expect(TITLE_MINOR_WORDS.has('or')).toBe(true)
    expect(TITLE_MINOR_WORDS.has('of')).toBe(true)
    expect(TITLE_MINOR_WORDS.has('in')).toBe(true)
    expect(TITLE_MINOR_WORDS.has('on')).toBe(true)
  })

  it('single word always capitalized', () => {
    expect(toTitleCase(['the'])).toBe('The')
  })

  it('empty array', () => {
    expect(toTitleCase([])).toBe('')
  })
})

// ── Sentence case ─────────────────────────────────────────────────────────────

describe('toSentenceCase', () => {
  it('basic', () => {
    expect(toSentenceCase(['hello', 'world'])).toBe('Hello world')
  })

  it('single word', () => {
    expect(toSentenceCase(['hello'])).toBe('Hello')
  })

  it('empty array', () => {
    expect(toSentenceCase([])).toBe('')
  })

  it('rest stays lowercase', () => {
    expect(toSentenceCase(['the', 'quick', 'brown', 'fox'])).toBe('The quick brown fox')
  })
})

// ── Lower / Upper case ────────────────────────────────────────────────────────

describe('toLowerCaseWords', () => {
  it('basic', () => {
    expect(toLowerCaseWords(['hello', 'world'])).toBe('hello world')
  })

  it('empty array', () => {
    expect(toLowerCaseWords([])).toBe('')
  })
})

describe('toUpperCaseWords', () => {
  it('basic', () => {
    expect(toUpperCaseWords(['hello', 'world'])).toBe('HELLO WORLD')
  })

  it('empty array', () => {
    expect(toUpperCaseWords([])).toBe('')
  })
})

// ── Alternating case ──────────────────────────────────────────────────────────

describe('toAlternatingCase', () => {
  it('basic lowercase input', () => {
    expect(toAlternatingCase('hello')).toBe('hElLo')
  })

  it('basic uppercase input', () => {
    expect(toAlternatingCase('HELLO')).toBe('hElLo')
  })

  it('mixed with spaces — spaces do not advance counter', () => {
    // h(0=lower) e(1=upper) l(2=lower) l(3=upper) o(4=lower) [space no advance] w(5=upper) o(6=lower) r(7=upper) l(8=lower) d(9=upper)
    expect(toAlternatingCase('hello world')).toBe('hElLo WoRlD')
  })

  it('non-letter chars preserved', () => {
    expect(toAlternatingCase('a1b2c')).toBe('a1B2c')
  })

  it('empty string', () => {
    expect(toAlternatingCase('')).toBe('')
  })
})

// ── Inverse (swap) case ───────────────────────────────────────────────────────

describe('toInverseCase', () => {
  it('swaps all letters', () => {
    expect(toInverseCase('Hello World')).toBe('hELLO wORLD')
  })

  it('already all lowercase', () => {
    expect(toInverseCase('hello')).toBe('HELLO')
  })

  it('already all uppercase', () => {
    expect(toInverseCase('HELLO')).toBe('hello')
  })

  it('preserves non-letter chars', () => {
    expect(toInverseCase('Hello, World! 123')).toBe('hELLO, wORLD! 123')
  })

  it('empty string', () => {
    expect(toInverseCase('')).toBe('')
  })

  it('unicode letters', () => {
    expect(toInverseCase('Über')).toBe('üBER')
  })
})

// ── Multi-line handling ───────────────────────────────────────────────────────

describe('multi-line (convertAll)', () => {
  it('converts each line independently — camelCase', () => {
    const defs = CONVERSION_DEFS
    const camelDef = defs.find((d) => d.id === 'camelCase')!
    const result = camelDef.convert('hello world\nfoo bar')
    expect(result).toBe('helloWorld\nfooBar')
  })

  it('converts each line independently — snake_case', () => {
    const snakeDef = CONVERSION_DEFS.find((d) => d.id === 'snakeCase')!
    const result = snakeDef.convert('hello world\nfoo bar')
    expect(result).toBe('hello_world\nfoo_bar')
  })

  it('empty lines passed through as empty string', () => {
    const snakeDef = CONVERSION_DEFS.find((d) => d.id === 'snakeCase')!
    const result = snakeDef.convert('hello world\n\nfoo bar')
    expect(result).toBe('hello_world\n\nfoo_bar')
  })

  it('alternating case applied per line independently', () => {
    const altDef = CONVERSION_DEFS.find((d) => d.id === 'alternatingCase')!
    const result = altDef.convert('hello\nworld')
    // Each line resets: 'hello' → 'hElLo', 'world' → 'wOrLd'
    expect(result).toBe('hElLo\nwOrLd')
  })

  it('inverse case applied per line', () => {
    const invDef = CONVERSION_DEFS.find((d) => d.id === 'inverseCase')!
    const result = invDef.convert('Hello\nWorld')
    expect(result).toBe('hELLO\nwORLD')
  })
})

// ── convertAll ────────────────────────────────────────────────────────────────

describe('convertAll', () => {
  it('returns 14 results', () => {
    const results = convertAll('hello world')
    expect(results).toHaveLength(14)
  })

  it('returns empty values for empty input', () => {
    const results = convertAll('')
    for (const r of results) {
      expect(r.value).toBe('')
    }
  })

  it('returns empty values for whitespace-only input', () => {
    const results = convertAll('   ')
    for (const r of results) {
      expect(r.value).toBe('')
    }
  })

  it('correct camelCase for "hello world"', () => {
    const results = convertAll('hello world')
    const r = results.find((x) => x.id === 'camelCase')!
    expect(r.value).toBe('helloWorld')
  })

  it('correct PascalCase for "hello world"', () => {
    const results = convertAll('hello world')
    const r = results.find((x) => x.id === 'pascalCase')!
    expect(r.value).toBe('HelloWorld')
  })

  it('correct snake_case for "hello world"', () => {
    const results = convertAll('hello world')
    const r = results.find((x) => x.id === 'snakeCase')!
    expect(r.value).toBe('hello_world')
  })

  it('correct SCREAMING_SNAKE_CASE', () => {
    const results = convertAll('hello world')
    const r = results.find((x) => x.id === 'screamingSnakeCase')!
    expect(r.value).toBe('HELLO_WORLD')
  })

  it('correct kebab-case', () => {
    const results = convertAll('hello world')
    const r = results.find((x) => x.id === 'kebabCase')!
    expect(r.value).toBe('hello-world')
  })

  it('correct Train-Case', () => {
    const results = convertAll('hello world')
    const r = results.find((x) => x.id === 'trainCase')!
    expect(r.value).toBe('Hello-World')
  })

  it('correct dot.case', () => {
    const results = convertAll('hello world')
    const r = results.find((x) => x.id === 'dotCase')!
    expect(r.value).toBe('hello.world')
  })

  it('correct path/case', () => {
    const results = convertAll('hello world')
    const r = results.find((x) => x.id === 'pathCase')!
    expect(r.value).toBe('hello/world')
  })

  it('correct Title Case with minor words', () => {
    const results = convertAll('lord of the rings')
    const r = results.find((x) => x.id === 'titleCase')!
    expect(r.value).toBe('Lord of the Rings')
  })

  it('correct Sentence case', () => {
    const results = convertAll('hello world')
    const r = results.find((x) => x.id === 'sentenceCase')!
    expect(r.value).toBe('Hello world')
  })

  it('correct lowercase', () => {
    const results = convertAll('Hello World')
    const r = results.find((x) => x.id === 'lowerCase')!
    expect(r.value).toBe('hello world')
  })

  it('correct UPPERCASE', () => {
    const results = convertAll('hello world')
    const r = results.find((x) => x.id === 'upperCase')!
    expect(r.value).toBe('HELLO WORLD')
  })

  it('correct alternating case', () => {
    const results = convertAll('hello')
    const r = results.find((x) => x.id === 'alternatingCase')!
    expect(r.value).toBe('hElLo')
  })

  it('correct inverse case', () => {
    const results = convertAll('Hello World')
    const r = results.find((x) => x.id === 'inverseCase')!
    expect(r.value).toBe('hELLO wORLD')
  })
})

// ── Round-trip tokenize tests ─────────────────────────────────────────────────

describe('round-trip: tokenize → convert', () => {
  it('HTTPServer → camelCase → httpServer', () => {
    expect(toCamelCase(tokenize('HTTPServer'))).toBe('httpServer')
  })

  it('XMLHttpRequest → PascalCase → XmlHttpRequest', () => {
    expect(toPascalCase(tokenize('XMLHttpRequest'))).toBe('XmlHttpRequest')
  })

  it('user-name_here → camelCase → userNameHere', () => {
    expect(toCamelCase(tokenize('user-name_here'))).toBe('userNameHere')
  })

  it('user2Name → snake_case → user_2_name', () => {
    expect(toSnakeCase(tokenize('user2Name'))).toBe('user_2_name')
  })

  it('kebab-input → kebab-case unchanged', () => {
    expect(toKebabCase(tokenize('my-kebab-input'))).toBe('my-kebab-input')
  })

  it('dot.case.input → dot.case unchanged', () => {
    expect(toDotCase(tokenize('my.dot.case'))).toBe('my.dot.case')
  })
})
