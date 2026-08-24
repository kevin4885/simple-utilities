import { describe, it, expect } from 'vitest'
import { searchTools } from './search'
import { tools } from '@/tools/registry'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function ids(results: ReturnType<typeof searchTools>) {
  return results.map((t) => t.id)
}

// ---------------------------------------------------------------------------
// Empty / whitespace query → all tools in registry order
// ---------------------------------------------------------------------------

describe('searchTools — empty query', () => {
  it('returns all tools for empty string', () => {
    const result = searchTools('')
    expect(result).toHaveLength(tools.length)
    expect(ids(result)).toEqual(ids(tools))
  })

  it('returns all tools for whitespace-only string', () => {
    const result = searchTools('   ')
    expect(result).toHaveLength(tools.length)
    expect(ids(result)).toEqual(ids(tools))
  })

  it('returns all tools for tab/newline whitespace', () => {
    const result = searchTools('\t\n')
    expect(result).toHaveLength(tools.length)
    expect(ids(result)).toEqual(ids(tools))
  })
})

// ---------------------------------------------------------------------------
// Exact title matches rank first
// ---------------------------------------------------------------------------

describe('searchTools — exact title matches', () => {
  it('"JSON Formatter" ranks json-formatter first', () => {
    const result = searchTools('JSON Formatter')
    expect(ids(result)[0]).toBe('json-formatter')
  })

  it('"json" ranks json-formatter first', () => {
    const result = searchTools('json')
    expect(ids(result)[0]).toBe('json-formatter')
  })

  it('"JWT Decoder" ranks jwt-decoder first', () => {
    const result = searchTools('JWT Decoder')
    expect(ids(result)[0]).toBe('jwt-decoder')
  })

  it('"Color Converter" ranks color-converter first', () => {
    const result = searchTools('Color Converter')
    expect(ids(result)[0]).toBe('color-converter')
  })
})

// ---------------------------------------------------------------------------
// Typo tolerance cases (the specific ones called out in the requirements)
// ---------------------------------------------------------------------------

describe('searchTools — typo tolerance', () => {
  it('"josn" matches json-formatter (transposition typo)', () => {
    const result = searchTools('josn')
    expect(ids(result)).toContain('json-formatter')
  })

  it('"josn" has json-formatter ranked first', () => {
    const result = searchTools('josn')
    expect(ids(result)[0]).toBe('json-formatter')
  })

  it('"fromatter" matches json-formatter (deletion typo)', () => {
    const result = searchTools('fromatter')
    expect(ids(result)).toContain('json-formatter')
  })

  it('"fromatter" has json-formatter ranked first', () => {
    const result = searchTools('fromatter')
    expect(ids(result)[0]).toBe('json-formatter')
  })
})

// ---------------------------------------------------------------------------
// Exact keyword matches
// ---------------------------------------------------------------------------

describe('searchTools — exact keyword matches', () => {
  it('"jwt" matches jwt-decoder', () => {
    const result = searchTools('jwt')
    expect(ids(result)).toContain('jwt-decoder')
  })

  it('"jwt" ranks jwt-decoder first', () => {
    const result = searchTools('jwt')
    expect(ids(result)[0]).toBe('jwt-decoder')
  })

  it('"prettify" matches json-formatter', () => {
    const result = searchTools('prettify')
    expect(ids(result)).toContain('json-formatter')
  })

  it('"prettify" ranks json-formatter first', () => {
    const result = searchTools('prettify')
    expect(ids(result)[0]).toBe('json-formatter')
  })

  it('"pizza" matches pizza-dough', () => {
    const result = searchTools('pizza')
    expect(ids(result)[0]).toBe('pizza-dough')
  })

  it('"escape" matches string-escaper', () => {
    const result = searchTools('escape')
    expect(ids(result)).toContain('string-escaper')
  })
})

// ---------------------------------------------------------------------------
// Keyword-only matches (word not in title or description top-level)
// ---------------------------------------------------------------------------

describe('searchTools — keyword-only matches', () => {
  it('"prettify" is a keyword of json-formatter (not in title)', () => {
    // "prettify" does not appear in the title "JSON Formatter" — keyword only
    const tool = tools.find((t) => t.id === 'json-formatter')!
    expect(tool.title.toLowerCase()).not.toContain('prettify')
    expect(tool.keywords).toContain('prettify')
    // And it still matches
    expect(ids(searchTools('prettify'))).toContain('json-formatter')
  })

  it('"minify" matches json-formatter via keyword', () => {
    expect(ids(searchTools('minify'))).toContain('json-formatter')
  })

  it('"baking" matches pizza-dough via keyword', () => {
    expect(ids(searchTools('baking'))).toContain('pizza-dough')
  })

  it('"fishing" matches llano-castell via keyword', () => {
    expect(ids(searchTools('fishing'))).toContain('llano-castell')
  })
})

// ---------------------------------------------------------------------------
// Multi-tool keyword matches
// ---------------------------------------------------------------------------

describe('searchTools — multi-tool keyword matches', () => {
  it('"token" matches both jwt-decoder and markdown-editor', () => {
    // jwt-decoder has 'token' in keywords; markdown-editor has 'tokens' in keywords
    const result = searchTools('token')
    const resultIds = ids(result)
    expect(resultIds).toContain('jwt-decoder')
    expect(resultIds).toContain('markdown-editor')
  })
})

// ---------------------------------------------------------------------------
// Nonsense / garbage queries return empty
// ---------------------------------------------------------------------------

describe('searchTools — nonsense queries return empty', () => {
  it('completely random string returns no results', () => {
    expect(searchTools('xyzabc123')).toHaveLength(0)
  })

  it('unrelated long string returns no results', () => {
    expect(searchTools('qqqqqqqqqqqq')).toHaveLength(0)
  })
})
