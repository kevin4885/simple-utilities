# src/components/editor — CLAUDE.md

Shared, reusable editor components for tools that need code editing or markdown rendering.
These are hand-rolled app components — **not** shadcn/ui (which lives in `src/components/ui/`).

## Files

| File | Component | Purpose |
|---|---|---|
| `CodeEditor.tsx` | `<CodeEditor>` | CodeMirror 6 editor — multi-language, themed, dark-aware |
| `MarkdownRenderer.tsx` | `<MarkdownRenderer>` | react-markdown renderer — full element coverage, syntax-highlighted code blocks |

---

## CodeEditor

A CodeMirror 6 wrapper. Tracks dark mode internally — no theme prop needed.

```tsx
import CodeEditor from '@/components/editor/CodeEditor'
import type { CodeLanguage } from '@/components/editor/CodeEditor'

<CodeEditor
  value={code}
  onChange={setCode}          // omit for read-only
  language="python"           // see CodeLanguage type below
  height="100%"               // default '100%'
  placeholder="Enter code…"
  readOnly={false}
  className="h-full"
/>
```

### `CodeLanguage` type
`'markdown' | 'javascript' | 'typescript' | 'jsx' | 'tsx' | 'css' | 'html' | 'json' | 'python' | 'sql' | 'yaml' | 'text'`

### Key notes
- **Does NOT manage per-document undo state.** If you need undo to survive document
  switches (like the markdown editor), maintain a `Map<id, EditorState>` in the parent
  and save/restore via `editorRef.current?.view.setState(saved)`.
- `EditorView.lineWrapping` is always enabled.
- Default `basicSetup`: line numbers on, fold gutter off, history on, indent on input.
  Pass `basicSetup={false}` to strip it, or an options object to tune individual flags.
- Uses `vscodeDark` (dark) / `vscodeLight` (light) with a transparent-background override
  so the editor inherits the surface behind it.

---

## MarkdownRenderer

A `react-markdown` renderer with full GFM support and syntax-highlighted code blocks.
Reads dark mode internally. Safe to render in any context — no layout assumptions.

```tsx
import MarkdownRenderer from '@/components/editor/MarkdownRenderer'

<MarkdownRenderer
  content={markdownString}
  className="px-5 py-4"         // optional extra wrapper classes
  emptyMessage="No content yet" // optional — default: "Nothing to preview yet"
/>
```

### Key notes
- **Empty state** is built-in: when `content` is empty/whitespace, renders a centred
  `FileText` icon + the `emptyMessage` label. Wrap in `h-full` to vertically centre it.
- Prism languages registered at **module level** (idempotent) — safe to import in
  multiple tools without double-registration side effects.
- `MD_COMPONENTS` is rebuilt only when dark mode flips (`useMemo`) — react-markdown
  does not re-parse unchanged content on unrelated parent re-renders.
- Code block themes: `vsc-dark-plus` (dark) / `one-light` (light) — matches `CodeEditor`.
- Labeled fenced blocks get a hover copy button.
- Unlabeled fenced blocks render as plain `<pre>` (good for ASCII diagrams).
- All colours use semantic Tailwind tokens — never raw hex.

---

## Adding a new language

**CodeEditor:** add to `LANG_EXTENSIONS` map in `CodeEditor.tsx`.
Install the `@codemirror/lang-*` package first (`npm info` for latest version).

**MarkdownRenderer:** add to `SUPPORTED_LANGUAGES` set and register with
`SyntaxHighlighter.registerLanguage(...)` at the top of `MarkdownRenderer.tsx`.
Import the language from `react-syntax-highlighter/dist/esm/languages/prism/<name>`.
