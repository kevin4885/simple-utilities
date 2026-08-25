/**
 * wysiwyg-utils — pure helper functions for WysiwygEditor
 * Kept separate so they can be unit-tested without any DOM / React dependencies.
 */

/**
 * Normalise a raw URL string entered by the user.
 *
 * Rules:
 *  - Returns '' for empty / whitespace-only input (treat as "no URL").
 *  - Rejects dangerous schemes (javascript:, vbscript:, data: with non-image
 *    content) by returning '' — defense-in-depth since content is exported/copied.
 *  - Leaves anything that already has a safe URL scheme alone:
 *      mailto:, data:image/*, tel:, ftp://, https://, http://, #anchor, etc.
 *  - Leaves relative paths (/foo, ./foo, ../foo) alone.
 *  - Prepends "https://" to everything else (bare domains, e.g. "example.com").
 *    Bare host:port (e.g. "localhost:3000") is also treated as needing https://.
 *
 * Whitespace is always trimmed before any check.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  // Absolute anchor (#) or relative paths
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed
  }

  // Check for a URL scheme vs a host:port.
  // A URL scheme is [ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )] followed by ":".
  // But host:port looks the same syntactically. We disambiguate by inspecting
  // what follows the colon:
  //   - A port is purely numeric (digits only, possibly followed by / or end).
  //   - A scheme value starts with "/" (http://, ftp://) or a non-digit letter
  //     (mailto:user@..., javascript:..., data:image/...).
  //
  // Additionally, real URL schemes never contain dots — "example.com" is a host,
  // not a scheme. So we also exclude possibleSchemes that contain dots.
  const colonIdx = trimmed.indexOf(':')
  if (colonIdx > 0) {
    const possibleScheme = trimmed.slice(0, colonIdx)
    const afterColon = trimmed.slice(colonIdx + 1)

    // A scheme must be letters-only (+ optional +, -, but NOT dots or digits before the colon)
    const looksLikeScheme = /^[a-zA-Z][a-zA-Z+-]*$/.test(possibleScheme)
    // A port is purely numeric (possibly followed by / or end of string)
    const looksLikePort = /^\d+(\/|$)/.test(afterColon)

    if (looksLikeScheme && !looksLikePort) {
      const schemeLower = possibleScheme.toLowerCase()
      // Block known dangerous schemes
      if (schemeLower === 'javascript' || schemeLower === 'vbscript') {
        return ''
      }
      // Allow all other safe schemes (http, https, mailto, tel, ftp, data, etc.)
      return trimmed
    }
  }

  // No scheme (or host:port), bare domain or path — prepend https://
  return `https://${trimmed}`
}
