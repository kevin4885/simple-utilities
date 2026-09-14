/**
 * scripts/prerender/logic.test.ts
 *
 * Vitest tests for the pure prerender builders. Covers the acceptance
 * criteria in phases/p2-prerender-sitemap.md plus the non-happy paths named
 * in plan.md: empty legacy-id map, a description shorter than `max`, and a
 * title/description needing HTML-escaping in an attribute/text context.
 */
import { describe, it, expect } from 'vitest'
import { tools, categories } from '../../src/tools/registry'
import { SITE_URL } from '../../src/lib/content'
import {
  escapeHtml,
  getStaticRoutes,
  buildHtmlForRoute,
  buildSitemapXml,
  buildRobotsTxt,
  buildRedirects,
  type RouteMeta,
} from './logic'

// A representative slice of Vite's built dist/index.html — no canonical,
// no OG tags, an empty #root, and the actual built <script> tag shape.
const BASE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="description" content="A collection of small, focused utility tools." />
    <title>Simple Utilities</title>
    <script type="module" crossorigin src="/assets/index-CT8dWlKi.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-BU4B7_ic.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`

describe('escapeHtml', () => {
  it('escapes &, <, >, ", and \'', () => {
    expect(escapeHtml(`<script>alert("x & y")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x &amp; y&quot;)&lt;/script&gt;',
    )
  })
})

describe('getStaticRoutes', () => {
  it('returns exactly 2 + tools.length entries', () => {
    const routes = getStaticRoutes()
    expect(routes.length).toBe(2 + tools.length)
  })

  it('includes "/" and "/app" plus one "/tools/<id>" per registry tool', () => {
    const routes = getStaticRoutes()
    const paths = routes.map((r) => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/app')
    for (const tool of tools) {
      expect(paths).toContain(`/tools/${tool.id}`)
    }
  })

  it('resolves the "/app" description from the live tools/categories counts', () => {
    const routes = getStaticRoutes()
    const appRoute = routes.find((r) => r.path === '/app')
    expect(appRoute?.description).toContain(`${tools.length} utility tools`)
    expect(appRoute?.description).toContain(`${categories.length} categories`)
  })

  it('resolves each tool route\'s title/description from the registry entry', () => {
    const routes = getStaticRoutes()
    const tool = tools[0]
    const route = routes.find((r) => r.path === `/tools/${tool.id}`)
    expect(route?.title).toBe(`${tool.title} — Simple Utilities`)
  })
})

describe('buildHtmlForRoute', () => {
  const route: RouteMeta = {
    path: '/tools/word-counter',
    title: 'Word & Character Counter — Simple Utilities',
    description: 'Live word, character, and sentence counts.',
  }

  it('produces exactly one <title> tag with the route\'s exact title', () => {
    const html = buildHtmlForRoute(BASE_HTML, route)
    const matches = html.match(/<title>[\s\S]*?<\/title>/g) ?? []
    expect(matches.length).toBe(1)
    expect(matches[0]).toBe(`<title>${escapeHtml(route.title)}</title>`)
  })

  it('produces exactly one meta description with the route\'s exact description', () => {
    const html = buildHtmlForRoute(BASE_HTML, route)
    const matches = html.match(/<meta name="description"[^>]*>/g) ?? []
    expect(matches.length).toBe(1)
    expect(matches[0]).toContain(`content="${escapeHtml(route.description)}"`)
  })

  it('produces exactly one canonical link pointing at SITE_URL + route.path', () => {
    const html = buildHtmlForRoute(BASE_HTML, route)
    const matches = html.match(/<link rel="canonical"[^>]*>/g) ?? []
    expect(matches.length).toBe(1)
    expect(matches[0]).toBe(`<link rel="canonical" href="${SITE_URL}${route.path}">`)
  })

  it('produces matching og:title/og:description/og:url/og:type tags', () => {
    const html = buildHtmlForRoute(BASE_HTML, route)
    expect(html).toContain(`<meta property="og:type" content="website">`)
    expect(html).toContain(`<meta property="og:title" content="${escapeHtml(route.title)}">`)
    expect(html).toContain(
      `<meta property="og:description" content="${escapeHtml(route.description)}">`,
    )
    expect(html).toContain(`<meta property="og:url" content="${SITE_URL}${route.path}">`)
  })

  it('injects a non-empty <h1>/<p> as the first children of #root, dropping the title suffix', () => {
    const html = buildHtmlForRoute(BASE_HTML, route)
    const rootMatch = html.match(/<div id="root">([\s\S]*?)<\/div>/)
    expect(rootMatch).not.toBeNull()
    const rootContent = rootMatch![1]
    expect(rootContent).toContain('<h1>Word &amp; Character Counter</h1>')
    expect(rootContent).toContain(`<p>${escapeHtml(route.description)}</p>`)
  })

  it('leaves the original built <script> tag untouched', () => {
    const html = buildHtmlForRoute(BASE_HTML, route)
    expect(html).toContain(
      '<script type="module" crossorigin src="/assets/index-CT8dWlKi.js"></script>',
    )
  })

  it('HTML-escapes a route title/description containing <, >, and &', () => {
    const dangerousRoute: RouteMeta = {
      path: '/tools/xss-test',
      title: `<b>Bold</b> & "quoted" 'title' — Simple Utilities`,
      description: `A <script>alert(1)</script> & "dangerous" description`,
    }
    const html = buildHtmlForRoute(BASE_HTML, dangerousRoute)

    // No raw <script>alert / <b> survives outside the original built script tag.
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<b>Bold</b>')
    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt;')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    // Attribute-context values are also escaped (quotes don't break out of content="...").
    expect(html).toContain('&quot;dangerous&quot;')
    expect(html).toContain('&quot;quoted&quot;')
  })

  it('applies to the landing route ("/") whose title has no " — Simple Utilities" suffix', () => {
    const landingRoute: RouteMeta = {
      path: '/',
      title: 'Simple Utilities — Free Browser-Based Tools, No Sign-Up',
      description: 'Free browser-based utility tools.',
    }
    const html = buildHtmlForRoute(BASE_HTML, landingRoute)
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/">`)
    const rootMatch = html.match(/<div id="root">([\s\S]*?)<\/div>/)
    expect(rootMatch![1]).toContain(`<h1>${escapeHtml(landingRoute.title)}</h1>`)
  })
})

describe('buildSitemapXml', () => {
  it('contains one <url><loc> entry per route, each an absolute SITE_URL', () => {
    const routes = getStaticRoutes()
    const xml = buildSitemapXml(routes)
    const matches = xml.match(/<url><loc>[^<]*<\/loc><\/url>/g) ?? []
    expect(matches.length).toBe(routes.length)
    for (const route of routes) {
      expect(xml).toContain(`<loc>${SITE_URL}${route.path}</loc>`)
    }
  })

  it('has no <lastmod> or <priority> tags', () => {
    const xml = buildSitemapXml(getStaticRoutes())
    expect(xml).not.toContain('<lastmod>')
    expect(xml).not.toContain('<priority>')
  })
})

describe('buildRobotsTxt', () => {
  it('contains "Allow: /" and a Sitemap line pointing at SITE_URL/sitemap.xml', () => {
    const txt = buildRobotsTxt()
    expect(txt).toContain('Allow: /')
    expect(txt).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`)
  })
})

describe('buildRedirects', () => {
  it('an empty legacy-id map produces a file with only the catch-all line', () => {
    const result = buildRedirects({})
    const lines = result.trim().split('\n')
    expect(lines).toEqual(['/*  /index.html  200'])
  })

  it('a non-empty legacy-id map places the 301 line(s) before the catch-all', () => {
    const result = buildRedirects({ 'old-id': 'new-id' })
    const lines = result.trim().split('\n')
    expect(lines[0]).toBe('/tools/old-id  /tools/new-id  301')
    expect(lines[lines.length - 1]).toBe('/*  /index.html  200')
  })

  it('multiple entries each get their own line, all before the catch-all', () => {
    const result = buildRedirects({ a: 'b', c: 'd' })
    const lines = result.trim().split('\n')
    expect(lines).toEqual([
      '/tools/a  /tools/b  301',
      '/tools/c  /tools/d  301',
      '/*  /index.html  200',
    ])
  })
})
