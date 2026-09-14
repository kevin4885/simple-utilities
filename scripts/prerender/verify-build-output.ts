/**
 * scripts/prerender/verify-build-output.ts
 *
 * Small integration check for the acceptance criteria that can only be
 * verified after a real `npm run build` has produced `dist/` (the Vitest
 * suite that `npm test` runs happens BEFORE `vite build`/the prerender step
 * in this repo's verification command — `npm run lint && npm test && npm
 * run build` — so those file-existence/uniqueness checks cannot live inside
 * `logic.test.ts` without a real `dist/` on disk).
 *
 * Not wired into any npm script (package.json's build script is limited to
 * `tsc -b && vite build && tsx scripts/prerender/run.ts` per the phase
 * contract) — this is a standalone check, run manually after `npm run
 * build`:
 *
 *   npx tsx scripts/prerender/verify-build-output.ts
 *
 * Exits non-zero (and prints what's missing/duplicated) on any failure.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tools } from '../../src/tools/registry'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, '../../dist')

function fail(message: string): never {
  console.error(`[verify-build-output] FAIL: ${message}`)
  process.exit(1)
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title>([\s\S]*?)<\/title>/)
  return match ? match[1] : null
}

function main(): void {
  if (!existsSync(DIST_DIR)) {
    fail(`dist/ does not exist at ${DIST_DIR} — run "npm run build" first.`)
  }

  const expectedFiles = [
    'index.html',
    'app/index.html',
    'robots.txt',
    'sitemap.xml',
    ...tools.map((t) => `tools/${t.id}/index.html`),
  ]

  const missing = expectedFiles.filter((f) => !existsSync(path.join(DIST_DIR, f)))
  if (missing.length > 0) {
    fail(`missing dist file(s): ${missing.join(', ')}`)
  }

  // dist/_redirects is Phase 3's file-scope — its absence here is expected
  // and correct for Phase 2, not asserted either way.

  const titles = new Set<string>()
  const duplicates: string[] = []
  for (const tool of tools) {
    const html = readFileSync(path.join(DIST_DIR, 'tools', tool.id, 'index.html'), 'utf-8')
    const title = extractTitle(html)
    if (!title) fail(`tools/${tool.id}/index.html has no <title> tag`)
    if (titles.has(title!)) duplicates.push(`${tool.id} ("${title}")`)
    titles.add(title!)
  }
  if (duplicates.length > 0) {
    fail(`duplicate tool <title> value(s): ${duplicates.join(', ')}`)
  }

  console.log(
    `[verify-build-output] OK — ${expectedFiles.length} expected file(s) present, ` +
      `${tools.length} unique tool titles.`,
  )
}

main()
