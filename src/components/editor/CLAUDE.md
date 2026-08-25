# src/components/editor — CLAUDE.md

Shared, reusable editor components for tools that need code editing, markdown
rendering, or WYSIWYG editing.
These are hand-rolled app components — **not** shadcn/ui (which lives in `src/components/ui/`).

## Files

| File | Component | Purpose |
|---|---|---|
| `CodeEditor.tsx` | `<CodeEditor>` | CodeMirror 6 editor — multi-language, themed, dark-aware |
| `MarkdownRenderer.tsx` | `<MarkdownRenderer>` | react-markdown renderer — full element coverage, syntax-highlighted code blocks |
| `WysiwygEditor.tsx` | `<WysiwygEditor>` | TipTap WYSIWYG editor — markdown in / markdown out, slash menu, bubble menus, tables, task lists |
| `wysiwyg-utils.ts` | — | Pure helpers for WysiwygEditor — `normalizeUrl()` and future utils |
| `wysiwyg-utils.test.ts` | — | Vitest unit tests for `wysiwyg-utils.ts` |

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

## WysiwygEditor

A TipTap (ProseMirror) WYSIWYG editor with markdown as the single source of truth.
Tracks dark mode internally. Can be embedded standalone — safe to use without the
full VME tool page.

### Dependencies

- **shadcn/ui**: `popover`, `input`, `button`, `label` — required for the link/image
  popover forms. All must be present in `src/components/ui/`.
- **@tiptap/react/menus**: `BubbleMenu` component — for link, image, and table
  context toolbars. Ships with `@tiptap/react` v3 (no extra install needed).
- **@tiptap/extension-bubble-menu**: underlying plugin (transitive dep of @tiptap/react).
- **@floating-ui/dom**: positioning library used by BubbleMenu v3 (transitive dep of
  @tiptap/extension-bubble-menu — no extra install needed).

```tsx
import WysiwygEditor from '@/components/editor/WysiwygEditor'

<WysiwygEditor
  value={markdownString}
  onChange={(md) => setContent(md)}   // called on every edit
  placeholder="Start writing…"
  readOnly={false}
  className="h-full"
  minimal={false}                     // see below
/>
```

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `string` | — | **Required.** Markdown string — the single source of truth. |
| `onChange` | `(md: string) => void` | — | Called with new markdown on every edit. |
| `placeholder` | `string` | `'Start writing… (type / for commands)'` | Placeholder text when empty. |
| `readOnly` | `boolean` | `false` | Disables editing. |
| `className` | `string` | — | Extra wrapper classes. |
| `minimal` | `boolean` | `false` | No slash menu — pure keyboard surface for inline embedding. |

### Key notes

- **Markdown round-trip**: `value` is parsed → ProseMirror doc on mount / external value
  change; the doc is serialised → markdown on every edit via `tiptap-markdown`.
- **GFM support**: headings H1-H6, paragraph, bold, italic, strikethrough, inline code,
  links, blockquote, fenced code blocks with language, bullet/ordered/task lists,
  tables, horizontal rule, images.
- **Markdown input rules** auto-convert as you type: `# `…`###### ` headings, `- `/`* `
  bullet list, `1. ` ordered list, `[ ] `/`[x] ` task list, `> ` blockquote,
  ` ``` ` fenced code block, `---` horizontal rule, plus inline `**bold**`, `*italic*`,
  `~~strike~~`, `` `code` ``.
- **Slash menu** (when `minimal=false`): type `/` to open a command palette. Arrow keys
  navigate, Enter selects, Escape closes. Supports all block and inline components.
- **Table keyboard UX**: Tab/Shift-Tab move between cells; Enter adds a new row when on
  the last cell of the last row.
- **Dark mode**: tracked via `MutationObserver` on `document.documentElement.classList` —
  same pattern as `CodeEditor` and `MarkdownRenderer`.
- **External value sync**: when the `value` prop changes (e.g. doc switch), the editor
  calls `setContent(value, { emitUpdate: false })` without triggering `onChange`, so the
  cursor position resets cleanly. A suppress-flag prevents the round-trip loop.
- **minimal=true use case**: inline embedding for LLM prompt inputs. No slash menu popup;
  link/image/table bubble menus still work; markdown input rules and full keyboard
  editing still work.

---

### Link editing

The link interaction model is entirely mouse-driven (no `window.prompt`):

1. **Inserting a new link (no selection):** type `/link` in the slash menu and press
   Enter — a popover form appears with **Text** and **URL** fields. Type the text and URL,
   press Enter or click Save. The text is inserted at the cursor as a hyperlink.

2. **Inserting a link over a selection:** select text first, then type `/link`. The
   **Text** field is prefilled from the selection. Enter a URL and Save to wrap the
   selected text in a link.

3. **Editing an existing link:** click inside any existing link or place the caret
   inside it. A **bubble toolbar** appears below the link showing:
   - The truncated URL
   - **Open** button (opens URL in new tab)
   - **Edit** button (opens the popover prefilled with current text + href)
   - **Unlink** button (removes the link mark, leaves text)

4. **URL normalisation** (`normalizeUrl()` in `wysiwyg-utils.ts`):
   - Trims whitespace.
   - Empty → no-op (treated as "remove link").
   - Leaves `#anchor`, `/path`, `./rel`, `../up` unchanged.
   - Leaves `https://`, `mailto:`, `tel:`, `data:`, `ftp://`, etc. unchanged.
   - Prepends `https://` to bare domains and `host:port` URLs.
   - Blocks `javascript:` and `vbscript:` (returns `''`).

---

### Image editing

The image interaction model is entirely mouse-driven (no `window.prompt`):

1. **Inserting a new image:** type `/image` in the slash menu — a popover form appears
   with **Image URL** and **Alt text** fields. Accepts HTTPS URLs *and* base64 `data:`
   URIs (for local/pasted images).

2. **Editing an existing image:** click the image to select it. A **bubble toolbar**
   appears below with:
   - **Edit** button (reopens the popover prefilled with current src + alt)
   - **Remove** button (deletes the image node)

---

### Table editing

Table keyboard shortcuts remain unchanged (Tab / Shift-Tab / Enter).  
A **bubble toolbar** also appears above any table when the cursor is inside it:

| Button | Action |
|---|---|
| Add row above | `addRowBefore()` |
| Add row below | `addRowAfter()` |
| Delete row | `deleteRow()` |
| Add column before | `addColumnBefore()` |
| Add column after | `addColumnAfter()` |
| Delete column | `deleteColumn()` |
| Delete table | `deleteTable()` |

All buttons carry `title` and `aria-label` tooltips.

---

### Bubble menu implementation notes

TipTap v3's `BubbleMenu` (from `@tiptap/react/menus`) uses **@floating-ui/dom** for
positioning — not Tippy.js. The prop is `options={{ placement: 'bottom' }}` (not
`tippyOptions`).

Three `BubbleMenu` instances are registered; they gate each other via `shouldShow`:

| Bubble | shouldShow condition |
|---|---|
| `linkBubble` | `e.isActive('link') && !e.isActive('image')` |
| `imageBubble` | `e.isActive('image')` |
| `tableBubble` | `e.isActive('table') && !e.isActive('link') && !e.isActive('image')` |

This ensures only one bubble menu is ever visible at a time.

The link/image **popover forms** (shadcn `Popover`) are rendered separately from the
bubble toolbars — they are portalled to `<body>` by Radix UI's `PopoverPortal`.
The `PopoverAnchor` is a hidden `position:absolute` span that lets the popover open
without a visible trigger element. Because the popover content is portalled to body,
it naturally layers above the editor and the BubbleMenu toolbars.

Inner form components (`LinkForm`, `ImageForm`) are remounted via a `key` prop
whenever the popover (re-)opens — this resets `useState` initializers cleanly without
needing a `useEffect + setState` pattern (which would trigger the
`react-hooks/set-state-in-effect` lint rule).

---

### Embedding as a standalone prompt input (minimal mode)

```tsx
// Inline LLM prompt textarea — keyboard-only, no slash menu
<WysiwygEditor
  value={prompt}
  onChange={setPrompt}
  minimal={true}
  placeholder="Describe what you want…"
  className="border border-input rounded-md bg-background"
/>
```

---

### Markdown serializer choice

Uses `tiptap-markdown` (v0.9.x) which targets Tiptap v3.
If it becomes unmaintained, the fallback is `prosemirror-markdown`'s
`defaultMarkdownSerializer` wrapped in a custom Tiptap extension.

---

## Adding a new language

**CodeEditor:** add to `LANG_EXTENSIONS` map in `CodeEditor.tsx`.
Install the `@codemirror/lang-*` package first (`npm info` for latest version).

**MarkdownRenderer:** add to `SUPPORTED_LANGUAGES` set and register with
`SyntaxHighlighter.registerLanguage(...)` at the top of `MarkdownRenderer.tsx`.
Import the language from `react-syntax-highlighter/dist/esm/languages/prism/<name>`.

**WysiwygEditor:** no additional configuration — code blocks render as `<pre>` with
a `wysiwyg-code-block` CSS class. Syntax highlighting in the WYSIWYG view is not
currently implemented (by design — focus is on markdown fidelity, not live highlighting).
