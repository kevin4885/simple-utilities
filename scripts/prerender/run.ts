/**
 * scripts/prerender/run.ts
 *
 * Entry point run via `tsx` as the final step of `npm run build`
 * (`"tsc -b && vite build && tsx scripts/prerender/run.ts"`). Reads
 * `dist/index.html` once, calls the pure builders in `./logic.ts`, and
 * writes the per-route static HTML plus `dist/robots.txt` and
 * `dist/sitemap.xml`.
 *
 * Does NOT write `dist/_redirects` — `buildRedirects` exists in `./logic.ts`
 * for symmetry with the other pure builders (Phase 2 of the plan), but
 * wiring its output to disk is Phase 3's file-scope.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getStaticRoutes, buildHtmlForRoute, buildSitemapXml, buildRobotsTxt } from './logic'
import { readBaseHtml, writeRouteHtml, writeSitemapXml, writeRobotsTxt } from './io'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, '../../dist')

async function main(): Promise<void> {
  const baseHtml = await readBaseHtml(DIST_DIR)
  const routes = getStaticRoutes()

  for (const route of routes) {
    const html = buildHtmlForRoute(baseHtml, route)
    await writeRouteHtml(DIST_DIR, route.path, html)
  }

  await writeSitemapXml(DIST_DIR, buildSitemapXml(routes))
  await writeRobotsTxt(DIST_DIR, buildRobotsTxt())

  console.log(`[prerender] wrote ${routes.length} route(s), sitemap.xml, robots.txt to ${DIST_DIR}`)
}

main().catch((err) => {
  console.error('[prerender] failed:', err)
  process.exitCode = 1
})
