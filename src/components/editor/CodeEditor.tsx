/**
 * CodeEditor
 *
 * A reusable CodeMirror 6 editor with:
 *   - vscodeDark / vscodeLight themes, transparent background so it inherits
 *     whatever surface it sits on (matches app theme automatically)
 *   - Support for 10 languages via the `language` prop
 *   - Dark mode tracked internally via MutationObserver — no prop needed
 *   - Read-only mode via `readOnly` prop
 *
 * Does NOT manage per-document undo state — that is the caller's responsibility
 * when multi-document support is needed (see markdown-editor/index.tsx).
 */

import { useState, useEffect, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { BasicSetupOptions } from '@uiw/codemirror-extensions-basic-setup'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode'
import { markdown  as langMarkdown  } from '@codemirror/lang-markdown'
import { javascript as langJavaScript } from '@codemirror/lang-javascript'
import { css       as langCss        } from '@codemirror/lang-css'
import { html      as langHtml       } from '@codemirror/lang-html'
import { json      as langJson       } from '@codemirror/lang-json'
import { python    as langPython     } from '@codemirror/lang-python'
import { sql       as langSql        } from '@codemirror/lang-sql'
import { yaml      as langYaml       } from '@codemirror/lang-yaml'
import { cn } from '@/lib/utils'

// ── Supported languages ───────────────────────────────────────────────────────

export type CodeLanguage =
  | 'markdown'
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  | 'css'
  | 'html'
  | 'json'
  | 'python'
  | 'sql'
  | 'yaml'
  | 'text'

const LANG_EXTENSIONS: Record<CodeLanguage, (() => Extension) | null> = {
  markdown:   () => langMarkdown(),
  javascript: () => langJavaScript({ jsx: false, typescript: false }),
  typescript: () => langJavaScript({ jsx: false, typescript: true }),
  jsx:        () => langJavaScript({ jsx: true,  typescript: false }),
  tsx:        () => langJavaScript({ jsx: true,  typescript: true }),
  css:        () => langCss(),
  html:       () => langHtml(),
  json:       () => langJson(),
  python:     () => langPython(),
  sql:        () => langSql(),
  yaml:       () => langYaml(),
  text:       null,
}

// ── Transparent-bg override ───────────────────────────────────────────────────
// Strips the hardcoded background from vscodeDark/vscodeLight so the editor
// inherits whatever card/surface it sits on.

function makeTransparentBg(dark: boolean): Extension {
  return EditorView.theme({
    '&':                    { backgroundColor: 'transparent !important', height: '100%' },
    '.cm-content':          { color: dark ? '#9ca3af' : '#374151' },
    '.cm-scroller':         { backgroundColor: 'transparent !important', overflow: 'auto' },
    '.cm-gutters':          {
      backgroundColor: 'transparent !important',
      borderRight: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
    },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(128,128,128,0.08) !important' },
    '.cm-activeLine':       { backgroundColor: 'rgba(128,128,128,0.08) !important' },
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: CodeLanguage
  height?: string
  className?: string
  placeholder?: string
  readOnly?: boolean
  /** Pass false to strip all basicSetup features, or an options object to tune them. */
  basicSetup?: boolean | BasicSetupOptions
}

export default function CodeEditor({
  value,
  onChange,
  language = 'text',
  height = '100%',
  className,
  placeholder,
  readOnly = false,
  basicSetup,
}: CodeEditorProps) {
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

  const extensions = useMemo<Extension[]>(() => {
    const base = dark ? vscodeDark : vscodeLight
    const baseExts = Array.isArray(base) ? base : [base]
    const langExt = LANG_EXTENSIONS[language]?.()
    return [
      ...(langExt ? [langExt] : []),
      EditorView.lineWrapping,
      ...baseExts,
      makeTransparentBg(dark),
    ]
  }, [dark, language])

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme="none"
      extensions={extensions}
      height={height}
      style={{ height }}
      placeholder={placeholder}
      readOnly={readOnly}
      basicSetup={
        basicSetup !== undefined
          ? basicSetup
          : {
              lineNumbers:              true,
              foldGutter:               false,
              highlightActiveLine:      true,
              history:                  true,
              dropCursor:               false,
              allowMultipleSelections:  false,
              indentOnInput:            true,
            }
      }
      className={cn('[&_.cm-editor]:h-full', className)}
    />
  )
}
