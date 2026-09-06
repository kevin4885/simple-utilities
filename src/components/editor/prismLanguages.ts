/**
 * prismLanguages
 *
 * Single source of truth for the PrismLight syntax-highlighter instance and
 * its registered languages, shared by `MarkdownRenderer.tsx` (in-app preview)
 * and the Markdown Editor's export builders (`export/exportComponents.tsx`) —
 * both need the exact same highlighter/language set so exported HTML matches
 * what the app previews.
 *
 * Registration happens once at module level (idempotent — PrismLight ignores
 * duplicate `registerLanguage` calls for the same name).
 */

import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import langBash       from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import langCss        from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import langHtml       from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import langJson       from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import langJs         from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import langJsx        from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import langMarkdown   from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import langPython     from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import langSql        from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import langTs         from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import langTsx        from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import langYaml       from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'

// ── Language registration (module-level, idempotent) ─────────────────────────

SyntaxHighlighter.registerLanguage('bash',       langBash)
SyntaxHighlighter.registerLanguage('shell',      langBash)
SyntaxHighlighter.registerLanguage('sh',         langBash)
SyntaxHighlighter.registerLanguage('css',        langCss)
SyntaxHighlighter.registerLanguage('html',       langHtml)
SyntaxHighlighter.registerLanguage('json',       langJson)
SyntaxHighlighter.registerLanguage('javascript', langJs)
SyntaxHighlighter.registerLanguage('jsx',        langJsx)
SyntaxHighlighter.registerLanguage('markdown',   langMarkdown)
SyntaxHighlighter.registerLanguage('python',     langPython)
SyntaxHighlighter.registerLanguage('sql',        langSql)
SyntaxHighlighter.registerLanguage('typescript', langTs)
SyntaxHighlighter.registerLanguage('tsx',        langTsx)
SyntaxHighlighter.registerLanguage('yaml',       langYaml)

/** The configured PrismLight component — import this everywhere instead of `react-syntax-highlighter` directly. */
export { SyntaxHighlighter }

/** Language ids with a registered Prism grammar (aliases included, e.g. 'sh' → bash grammar). */
export const SUPPORTED_LANGUAGES = new Set([
  'bash', 'shell', 'sh', 'css', 'html', 'json',
  'javascript', 'jsx', 'markdown', 'python',
  'sql', 'typescript', 'tsx', 'yaml',
])

/** Returns `lang` if it has a registered grammar, else falls back to `'javascript'`. */
export function resolveHighlightLanguage(lang: string): string {
  return SUPPORTED_LANGUAGES.has(lang) ? lang : 'javascript'
}
