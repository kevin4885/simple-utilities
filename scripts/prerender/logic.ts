/**
 * scripts/prerender/logic.ts
 *
 * Pure builders for the build-time static-prerender step — zero `fs` calls,
 * zero side effects. Everything file-system-related lives in `./io.ts` and
 * `./run.ts`, mirroring the repo's existing pure-builder/thin-I/O convention
 * (`src/tools/writing/markdown-editor/export/exportHtml.tsx` + `exportIo.ts`).
 *
 * Reads its route/title/description data from `src/tools/registry.ts` (the
 * single source of truth for tools/categories) and `src/lib/content.ts` (the
 * single source of truth for site-wide SEO/marketing copy) — never
 * hardcodes the tool list, its length, or any title/description text here.
 */

import { tools, categories } from '../../src/tools/registry'
import { SITE_URL, LANDING_COPY, truncateDescription } from '../../src/lib/content'

export interface RouteMeta {
  path: string
  title: string
  description: string
}

// ── Escaping ─────────────────────────────────────────────────────────────

/** Escape `& < > " '` for safe interpolation into HTML text/attribute contexts. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Route list ───────────────────────────────────────────────────────────

/**
 * Builds the full static route list — `/`, `/app`, and one `/tools/<id>`
 * entry per tool in `registry.ts` — each with its resolved title/description
 * per the plan's Contract table. Never a hardcoded count: always
 * `2 + tools.length` entries.
 */
export function getStaticRoutes(): RouteMeta[] {
  const routes: RouteMeta[] = [
    {
      path: '/',
      title: LANDING_COPY.title,
      description: LANDING_COPY.description,
    },
    {
      path: '/app',
      title: 'Browse Tools — Simple Utilities',
      description: `Browse all ${tools.length} utility tools across ${categories.length} categories — text, converters, developer tools, and more. No sign-up, runs in your browser.`,
    },
  ]

  for (const tool of tools) {
    routes.push({
      path: `/tools/${tool.id}`,
      title: `${tool.title} — Simple Utilities`,
      description: truncateDescription(tool.description, 155),
    })
  }

  return routes
}

// ── HTML ─────────────────────────────────────────────────────────────────

const TITLE_RE = /<title>[\s\S]*?<\/title>/
const META_DESCRIPTION_RE = /<meta\s+name="description"[^>]*>/
const CANONICAL_RE = /<link\s+rel="canonical"[^>]*>/
const OG_TYPE_RE = /<meta\s+property="og:type"[^>]*>/
const OG_TITLE_RE = /<meta\s+property="og:title"[^>]*>/
const OG_DESCRIPTION_RE = /<meta\s+property="og:description"[^>]*>/
const OG_URL_RE = /<meta\s+property="og:url"[^>]*>/
const ROOT_DIV_RE = /<div id="root">/

/**
 * Takes Vite's already-built `dist/index.html` as a string and returns a
 * new HTML string with `<title>`, `<meta name="description">`,
 * `<link rel="canonical">`, and OG tags (`og:type`/`og:title`/
 * `og:description`/`og:url`) swapped in for `route`, plus a static
 * `<h1>`/`<p>` text block injected as the first child inside
 * `<div id="root">...</div>`. `baseHtml`'s built `<script>` tag (client
 * boot) is left untouched.
 *
 * All title/description text is HTML-escaped before interpolation, whether
 * used in a text context (`<title>`, `<h1>`, `<p>`) or an attribute context
 * (`content="..."`, `href="..."`).
 */
export function buildHtmlForRoute(baseHtml: string, route: RouteMeta): string {
  const canonical = `${SITE_URL}${route.path}`
  const escapedTitle = escapeHtml(route.title)
  const escapedDescription = escapeHtml(route.description)
  const escapedCanonical = escapeHtml(canonical)

  // The static <h1> drops the " — Simple Utilities" suffix from the title
  // (present on every route's title except the landing page's, which has no
  // suffix to strip).
  const h1Text = escapeHtml(route.title.replace(/ — Simple Utilities$/, ''))

  let html = baseHtml

  html = html.replace(TITLE_RE, `<title>${escapedTitle}</title>`)

  html = META_DESCRIPTION_RE.test(html)
    ? html.replace(META_DESCRIPTION_RE, `<meta name="description" content="${escapedDescription}">`)
    : html.replace(
        /<\/head>/,
        `<meta name="description" content="${escapedDescription}"></head>`,
      )

  const canonicalTag = `<link rel="canonical" href="${escapedCanonical}">`
  html = CANONICAL_RE.test(html)
    ? html.replace(CANONICAL_RE, canonicalTag)
    : html.replace(/<\/head>/, `${canonicalTag}</head>`)

  const ogTags = [
    [OG_TYPE_RE, `<meta property="og:type" content="website">`],
    [OG_TITLE_RE, `<meta property="og:title" content="${escapedTitle}">`],
    [OG_DESCRIPTION_RE, `<meta property="og:description" content="${escapedDescription}">`],
    [OG_URL_RE, `<meta property="og:url" content="${escapedCanonical}">`],
  ] as const

  for (const [re, tag] of ogTags) {
    html = re.test(html) ? html.replace(re, tag) : html.replace(/<\/head>/, `${tag}</head>`)
  }

  const staticBlock = `<h1>${h1Text}</h1><p>${escapedDescription}</p>`
  html = html.replace(ROOT_DIV_RE, `<div id="root">${staticBlock}`)

  return html
}

// ── sitemap.xml / robots.txt ─────────────────────────────────────────────

/** `<url><loc>${SITE_URL}${route.path}</loc></url>` entries, one per route. */
export function buildSitemapXml(routes: RouteMeta[]): string {
  const urls = routes
    .map((route) => `  <url><loc>${escapeHtml(`${SITE_URL}${route.path}`)}</loc></url>`)
    .join('\n')

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urls}\n` +
    '</urlset>\n'
  )
}

export function buildRobotsTxt(): string {
  return `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`
}

// ── _redirects (built now for symmetry; wired to disk in Phase 3) ────────

/**
 * One `301` line per `legacyIds` entry (`/tools/<old>  /tools/<new>  301`),
 * followed by the SPA catch-all (`/*  /index.html  200`) last — order
 * matters for Cloudflare Pages (`_redirects` is evaluated top-to-bottom,
 * first match wins). An empty `legacyIds` map produces a file containing
 * only the catch-all line.
 *
 * Built and tested here per plan.md's spec for symmetry with the other pure
 * builders; NOT wired to a file write in `io.ts`/`run.ts` — that wiring is
 * Phase 3's file-scope.
 */
export function buildRedirects(legacyIds: Record<string, string>): string {
  const lines = Object.entries(legacyIds).map(
    ([oldId, newId]) => `/tools/${oldId}  /tools/${newId}  301`,
  )
  lines.push('/*  /index.html  200')
  return lines.join('\n') + '\n'
}
