/**
 * MarkdownRenderer
 *
 * Renders a markdown string as themed HTML using react-markdown + remark-gfm.
 *
 * Features:
 *   - Full element coverage: headings, paragraphs, lists, tables, blockquotes,
 *     inline code, fenced code blocks (labeled + unlabeled), links, hr
 *   - Labeled fenced blocks: syntax-highlighted via react-syntax-highlighter
 *     (PrismLight) with a hover copy button. Dark mode: vsc-dark-plus,
 *     light mode: one-light — matching the CodeEditor vscode theme.
 *   - Unlabeled fenced blocks: plain monospace <pre> (ASCII diagrams etc.)
 *   - All colours use semantic Tailwind tokens — never raw hex values
 *   - Dark mode tracked internally via MutationObserver — no prop needed
 *   - MD_COMPONENTS rebuilt only when dark mode flips (useMemo)
 *   - Prism languages registered once at module level (idempotent)
 *
 * Empty state:
 *   When `content` is empty/whitespace, renders a centred FileText icon
 *   with a "Nothing to preview yet" message.
 *   Use the `emptyMessage` prop to customise the label.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus'
import oneLight    from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
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
import { FileText, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

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

const SUPPORTED_LANGUAGES = new Set([
  'bash', 'shell', 'sh', 'css', 'html', 'json',
  'javascript', 'jsx', 'markdown', 'python',
  'sql', 'typescript', 'tsx', 'yaml',
])

// ── MD_COMPONENTS factory ─────────────────────────────────────────────────────
// Called only when `dark` flips. The result is memoised and passed as the
// stable `components` prop so react-markdown never re-parses unchanged content.

function makeMdComponents(dark: boolean, onCopy: (code: string) => void) {
  return {

    // Strip react-markdown's outer <pre> — CodeText provides its own
    pre({ children }: { children?: React.ReactNode }) {
      return <>{children}</>
    },

    // Links always open in a new tab
    a({ node: _n, href, children, ...props }:
        React.ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary hover:underline"
          {...props}
        >
          {children}
        </a>
      )
    },

    // Three code cases — see module JSDoc for detection logic
    code({ className, children, node: _n, ...props }:
           React.ComponentPropsWithoutRef<'code'> & { node?: unknown }) {
      const match        = /language-(\w+)/.exec(className ?? '')
      const detectedLang = match ? match[1] : ''

      // Case 1: labeled fenced block — syntax highlighted
      if (detectedLang) {
        const language = SUPPORTED_LANGUAGES.has(detectedLang)
          ? detectedLang
          : 'javascript'
        const code = String(children).replace(/\n$/, '')
        return (
          <div className="relative group my-3">
            <button
              onClick={() => onCopy(code)}
              className={cn(
                'absolute right-2 top-2 z-10 p-1 rounded transition-colors',
                'text-foreground hover:text-primary hover:bg-muted',
                'opacity-0 group-hover:opacity-100 focus:opacity-100',
              )}
              aria-label="Copy code"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <SyntaxHighlighter
              language={language}
              style={dark ? vscDarkPlus : oneLight}
              showLineNumbers
              wrapLines
              customStyle={{ margin: 0, borderRadius: '0.5rem', fontSize: '0.8rem' }}
            >
              {code}
            </SyntaxHighlighter>
          </div>
        )
      }

      // react-markdown always appends '\n' to fenced content; inline never has one
      const isBlock = String(children).includes('\n')

      // Case 2: unlabeled fenced block — plain monospace
      if (isBlock) {
        return (
          <pre className="font-mono text-sm bg-muted px-4 py-3 rounded-lg overflow-x-auto my-3 whitespace-pre leading-snug border border-border">
            <code>{String(children).replace(/\n$/, '')}</code>
          </pre>
        )
      }

      // Case 3: inline code
      return (
        <code
          className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono border border-border/60"
          {...props}
        >
          {children}
        </code>
      )
    },

    h1({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>) {
      return <h1 className="text-2xl font-bold mt-6 mb-3 leading-tight border-b border-border pb-1" {...props}>{children}</h1>
    },
    h2({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>) {
      return <h2 className="text-xl font-bold mt-5 mb-2 leading-tight border-b border-border pb-1" {...props}>{children}</h2>
    },
    h3({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>) {
      return <h3 className="text-base font-semibold mt-4 mb-1.5 leading-tight" {...props}>{children}</h3>
    },
    h4({ children, ...props }: React.ComponentPropsWithoutRef<'h4'>) {
      return <h4 className="text-sm font-semibold mt-3 mb-1" {...props}>{children}</h4>
    },
    h5({ children, ...props }: React.ComponentPropsWithoutRef<'h5'>) {
      return <h5 className="text-sm font-semibold mt-2 mb-1" {...props}>{children}</h5>
    },
    h6({ children, ...props }: React.ComponentPropsWithoutRef<'h6'>) {
      return <h6 className="text-sm font-medium mt-2 mb-1 text-muted-foreground" {...props}>{children}</h6>
    },

    p({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) {
      return <p className="leading-relaxed my-2" {...props}>{children}</p>
    },

    ul({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) {
      return <ul className="list-disc list-outside pl-5 space-y-1 my-2" {...props}>{children}</ul>
    },
    ol({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) {
      return <ol className="list-decimal list-outside pl-5 space-y-1 my-2" {...props}>{children}</ol>
    },
    li({ children, ...props }: React.ComponentPropsWithoutRef<'li'>) {
      return <li className="leading-relaxed" {...props}>{children}</li>
    },

    blockquote({ children, ...props }: React.ComponentPropsWithoutRef<'blockquote'>) {
      return (
        <blockquote
          className="border-l-4 border-primary/50 pl-4 py-1 my-3 italic text-muted-foreground bg-muted/30 rounded-r"
          {...props}
        >
          {children}
        </blockquote>
      )
    },

    hr({ ...props }: React.ComponentPropsWithoutRef<'hr'>) {
      return <hr className="my-5 border-border" {...props} />
    },

    table({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) {
      return (
        <div className="overflow-x-auto my-3">
          <table className="min-w-full border-collapse text-sm" {...props}>{children}</table>
        </div>
      )
    },
    thead({ children, ...props }: React.ComponentPropsWithoutRef<'thead'>) {
      return <thead className="bg-muted" {...props}>{children}</thead>
    },
    tbody({ children, ...props }: React.ComponentPropsWithoutRef<'tbody'>) {
      return <tbody className="divide-y divide-border" {...props}>{children}</tbody>
    },
    tr({ children, ...props }: React.ComponentPropsWithoutRef<'tr'>) {
      return <tr className="hover:bg-muted/50 transition-colors" {...props}>{children}</tr>
    },
    th({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) {
      return <th className="border border-border px-4 py-2 text-left font-semibold text-foreground" {...props}>{children}</th>
    },
    td({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) {
      return <td className="border border-border px-4 py-2 text-foreground/90" {...props}>{children}</td>
    },

    strong({ children, ...props }: React.ComponentPropsWithoutRef<'strong'>) {
      return <strong className="font-semibold" {...props}>{children}</strong>
    },
    em({ children, ...props }: React.ComponentPropsWithoutRef<'em'>) {
      return <em className="italic" {...props}>{children}</em>
    },
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface MarkdownRendererProps {
  /** The markdown string to render. */
  content: string
  /** Extra Tailwind classes on the wrapper div. */
  className?: string
  /** Label shown in the built-in empty state. Default: "Nothing to preview yet" */
  emptyMessage?: string
}

export default function MarkdownRenderer({
  content,
  className,
  emptyMessage = 'Nothing to preview yet',
}: MarkdownRendererProps) {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  )

  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() =>
      setDark(el.classList.contains('dark')),
    )
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  const handleCodeCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
  }, [])

  const components = useMemo(
    () => makeMdComponents(dark, handleCodeCopy),
    [dark, handleCodeCopy],
  )

  if (!content.trim()) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 select-none">
        <FileText className="h-10 w-10 opacity-20" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-1 text-sm leading-relaxed text-foreground', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
