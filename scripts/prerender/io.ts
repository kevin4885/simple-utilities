/**
 * scripts/prerender/io.ts
 *
 * Thin, side-effecting I/O wrappers for the build-time prerender step —
 * everything that PRODUCES the HTML/XML/text content lives in `./logic.ts`
 * (pure builders); this module only moves bytes to/from disk. Mirrors the
 * existing repo convention (`exportHtml.tsx` pure builders + `exportIo.ts`
 * thin I/O).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Reads `dist/index.html` (Vite's already-built output) as a UTF-8 string. */
export async function readBaseHtml(distDir: string): Promise<string> {
  return readFile(path.join(distDir, 'index.html'), 'utf-8')
}

/**
 * Writes `html` to `<distDir>/<routePath>/index.html` for a route (e.g.
 * `/app` → `dist/app/index.html`, `/tools/word-counter` →
 * `dist/tools/word-counter/index.html`). The landing route (`path: '/'`)
 * writes directly to `<distDir>/index.html` (overwritten in place — it
 * doubles as the Cloudflare fallback target).
 */
export async function writeRouteHtml(distDir: string, routePath: string, html: string): Promise<void> {
  const targetDir = routePath === '/' ? distDir : path.join(distDir, routePath)
  await mkdir(targetDir, { recursive: true })
  await writeFile(path.join(targetDir, 'index.html'), html, 'utf-8')
}

export async function writeSitemapXml(distDir: string, xml: string): Promise<void> {
  await writeFile(path.join(distDir, 'sitemap.xml'), xml, 'utf-8')
}

export async function writeRobotsTxt(distDir: string, txt: string): Promise<void> {
  await writeFile(path.join(distDir, 'robots.txt'), txt, 'utf-8')
}

export async function writeRedirects(distDir: string, txt: string): Promise<void> {
  await writeFile(path.join(distDir, '_redirects'), txt, 'utf-8')
}
