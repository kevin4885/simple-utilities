/**
 * src/lib/content.ts
 *
 * Single source of truth for site-wide SEO/marketing copy: the canonical site
 * URL, the landing page's headline/subhead/highlight copy, and the shared
 * description-truncation helper.
 *
 * Used by:
 * - The live client (`useDocumentMeta`, wired into `LandingPage`/`AppHomePage`/
 *   `ToolPage`) to set `document.title` / `<meta name="description">` on
 *   client-side navigation.
 * - The build-time prerender script (Phase 2 of this plan) to generate the
 *   same title/description/canonical values into static per-route HTML.
 *
 * Keeping both readers of this file means the live tab title and the
 * prerendered static HTML can never drift apart.
 */

export const SITE_URL = 'https://www.simpleutilities.com'

export interface LandingHighlight {
  title: string
  description: string
}

export interface LandingCopy {
  title: string
  description: string
  headline: string
  subhead: string
  highlights: LandingHighlight[]
}

// Placeholder marketing copy — clearly editable, the user will revise wording
// later. `description` is kept at or under 155 chars since it is used
// verbatim as the meta description (not run through `truncateDescription`).
export const LANDING_COPY: LandingCopy = {
  title: 'Simple Utilities — Free Browser-Based Tools, No Sign-Up',
  description:
    'Free browser-based utility tools for text, conversions, and developers. No sign-up, no install, no data leaves your device.',
  headline: 'Small tools that just work — right in your browser',
  subhead:
    'A growing collection of free, focused utilities for text, conversions, and developers. Nothing to install, nothing to sign up for, and your data never leaves your device.',
  highlights: [
    {
      title: 'No sign-up, ever',
      description: 'Every tool works instantly — no accounts, no email, no paywalls.',
    },
    {
      title: 'Runs entirely in your browser',
      description: 'Your input never leaves your device. Nothing is uploaded to a server.',
    },
    {
      title: 'Text & writing tools',
      description: 'Word counters, formatters, converters, and other everyday text utilities.',
    },
    {
      title: 'Developer tools',
      description: 'JSON formatting, encoding, diffing, and other small tools developers reach for daily.',
    },
    {
      title: 'Installable as an app',
      description: 'Add Simple Utilities to your home screen or desktop and use it offline.',
    },
  ],
}

/**
 * Truncates `text` to at most `max` characters, cutting at the last full
 * word boundary at or before `max` — never mid-word. Pure function.
 *
 * - A string already at or under `max` chars is returned unchanged.
 * - An empty string returns an empty string.
 */
export function truncateDescription(text: string, max = 155): string {
  if (text.length <= max) return text

  const slice = text.slice(0, max)
  const lastSpace = slice.lastIndexOf(' ')

  // No word boundary within `max` chars (a single very long "word") — fall
  // back to a hard cut rather than returning an empty string.
  if (lastSpace <= 0) return slice

  return slice.slice(0, lastSpace)
}
