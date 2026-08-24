/**
 * String Escaper — pure logic (no React, no side-effects)
 *
 * Converts between readable text and JSON-style escaped strings.
 *
 * Escape sequences handled: \n \r \t \b \f \\ \" \/ \uXXXX (and surrogate pairs).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EscapeOptions {
  /** Wrap the output in double-quote characters. */
  quotes: boolean
}

export interface UnescapeResult {
  ok: boolean
  value: string
  /** Human-readable error when ok=false */
  error?: string
}

// ── unescapeString ────────────────────────────────────────────────────────────

/**
 * Take a string containing JSON-style escape sequences and return the decoded text.
 *
 * Auto-strip behavior: if the input starts and ends with `"`, the outer quotes
 * are stripped before processing (one layer only — useful when pasting a JSON
 * string value directly from a JSON document).
 *
 * Invalid escape sequences are passed through unchanged (e.g. `\q` → `\q`).
 * Unterminated surrogates are passed through as their code-point literals.
 */
export function unescapeString(input: string): UnescapeResult {
  let src = input

  // Auto-strip one layer of surrounding double quotes
  if (src.startsWith('"') && src.endsWith('"') && src.length >= 2) {
    src = src.slice(1, -1)
  }

  try {
    // We use a state-machine parser so we can handle surrogate pairs and
    // invalid sequences gracefully rather than throwing.
    let out = ''
    let i = 0
    while (i < src.length) {
      if (src[i] !== '\\') {
        out += src[i++]
        continue
      }
      // Escape sequence
      const next = src[i + 1]
      if (next === undefined) {
        // Trailing backslash — pass through
        out += '\\'
        i++
        continue
      }
      switch (next) {
        case 'n':  out += '\n'; i += 2; break
        case 'r':  out += '\r'; i += 2; break
        case 't':  out += '\t'; i += 2; break
        case 'b':  out += '\b'; i += 2; break
        case 'f':  out += '\f'; i += 2; break
        case '\\': out += '\\'; i += 2; break
        case '"':  out += '"';  i += 2; break
        case '/':  out += '/';  i += 2; break
        case '0':  out += '\0'; i += 2; break
        case 'u': {
          const hex = src.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            // Invalid \uXXXX — pass through the \u literally
            out += '\\u'
            i += 2
            break
          }
          const cp = parseInt(hex, 16)
          i += 6

          // Check for surrogate pair
          if (cp >= 0xd800 && cp <= 0xdbff) {
            // High surrogate — look ahead for low surrogate
            if (src[i] === '\\' && src[i + 1] === 'u') {
              const hex2 = src.slice(i + 2, i + 6)
              if (/^[0-9a-fA-F]{4}$/.test(hex2)) {
                const cp2 = parseInt(hex2, 16)
                if (cp2 >= 0xdc00 && cp2 <= 0xdfff) {
                  // Valid pair — decode to supplementary character
                  const full = 0x10000 + ((cp - 0xd800) << 10) + (cp2 - 0xdc00)
                  out += String.fromCodePoint(full)
                  i += 6
                  break
                }
              }
            }
            // Lone high surrogate — pass through as replacement character
            out += '\uFFFD'
          } else if (cp >= 0xdc00 && cp <= 0xdfff) {
            // Lone low surrogate — pass through as replacement character
            out += '\uFFFD'
          } else {
            out += String.fromCharCode(cp)
          }
          break
        }
        default:
          // Unknown escape — pass through both characters
          out += '\\' + next
          i += 2
          break
      }
    }
    return { ok: true, value: out }
  } catch (e) {
    return {
      ok: false,
      value: '',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// ── escapeString ──────────────────────────────────────────────────────────────

/**
 * Escape readable text to a JSON-safe escaped string.
 *
 * Characters escaped: `"` `\` control characters (\n \r \t \b \f) and any
 * code unit outside the Basic Multilingual Plane (via surrogate pair \uXXXX).
 * Surrogate pairs from characters > U+FFFF are written as \uHHHH\uLLLL.
 *
 * Options:
 *   quotes: wrap the result in double-quote chars (default: false)
 */
export function escapeString(input: string, options: EscapeOptions = { quotes: false }): string {
  let out = ''
  // Iterate over code points to handle supplementary characters correctly
  for (const char of input) {
    const cp = char.codePointAt(0)!
    switch (char) {
      case '"':  out += '\\"'; break
      case '\\': out += '\\\\'; break
      case '\n': out += '\\n'; break
      case '\r': out += '\\r'; break
      case '\t': out += '\\t'; break
      case '\b': out += '\\b'; break
      case '\f': out += '\\f'; break
      default:
        if (cp < 0x20) {
          // Other control characters
          out += '\\u' + cp.toString(16).padStart(4, '0')
        } else if (cp === 0x2028 || cp === 0x2029) {
          // LINE SEPARATOR / PARAGRAPH SEPARATOR — break JS source when unescaped
          out += '\\u' + cp.toString(16).padStart(4, '0')
        } else if (cp > 0xffff) {
          // Supplementary character → surrogate pair
          const high = 0xd800 + ((cp - 0x10000) >> 10)
          const low  = 0xdc00 + ((cp - 0x10000) & 0x3ff)
          out += '\\u' + high.toString(16).padStart(4, '0')
          out += '\\u' + low.toString(16).padStart(4, '0')
        } else {
          out += char
        }
        break
    }
  }
  return options.quotes ? `"${out}"` : out
}
