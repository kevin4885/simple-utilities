# src/components/editor — CLAUDE.md

Shared, reusable editor components for tools that need code editing, markdown
rendering, or WYSIWYG editing.
These are hand-rolled app components — **not** shadcn/ui (which lives in `src/components/ui/`).

## Files

| File | Component | Purpose |
|---|---|---|
| `CodeEditor.tsx` | `<CodeEditor>` | CodeMirror 6 editor — multi-language, themed, dark-aware |
| `MarkdownRenderer.tsx` | `<MarkdownRenderer>` | react-markdown renderer — full element coverage, syntax-highlighted code blocks |
| `WysiwygEditor.tsx` | `<WysiwygEditor>` | TipTap WYSIWYG editor — markdown in / markdown out, slash menu, bubble menus (image + table), keyboard-first link editing |
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
- **@tiptap/react/menus**: `BubbleMenu` component — for image and table context
  toolbars. Ships with `@tiptap/react` v3 (no extra install needed).
- **@tiptap/extension-bubble-menu**: underlying plugin (transitive dep of @tiptap/react).
- **@floating-ui/dom**: positioning library used by BubbleMenu v3 (transitive dep of
  @tiptap/extension-bubble-menu — no extra install needed).

```tsx
import WysiwygEditor, { type WysiwygEditorHandle } from '@/components/editor/WysiwygEditor'
import { useRef } from 'react'

const editorRef = useRef<WysiwygEditorHandle>(null)

<WysiwygEditor
  ref={editorRef}
  value={markdownString}
  onChange={(md) => setContent(md)}   // debounced; called after 150ms idle
  placeholder="Start writing…"
  readOnly={false}
  className="h-full"
  minimal={false}                     // see below
  onChangeDebounceMs={150}            // default; 0 = synchronous
/>

// Flush before switching modes or unmounting:
editorRef.current?.flush()
```

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `string` | — | **Required.** Markdown string — the single source of truth. |
| `onChange` | `(md: string) => void` | — | Called with new markdown after debounce idle. |
| `placeholder` | `string` | `'Start writing… (type / for commands)'` | Placeholder text when empty. |
| `readOnly` | `boolean` | `false` | Disables editing. |
| `className` | `string` | — | Extra wrapper classes. |
| `minimal` | `boolean` | `false` | No slash menu — pure keyboard surface for inline embedding. |
| `onChangeDebounceMs` | `number` | `150` | Debounce delay for onChange. 0 = synchronous. |

### Imperative handle (`WysiwygEditorHandle`)

| Method | Description |
|---|---|
| `flush()` | Run getMarkdown() + onChange immediately, cancelling any pending debounce. |

**Call `flush()` before**:
- Switching away from wysiwyg mode (so the store has the latest markdown before the editor unmounts)
- Doc switching
- Any action that reads `activeDoc.content` right after editor changes

### Performance design

1. **`lastEmittedMd` ref**: The sync-effect that sets content when `value` changes now
   does a reference-equality check against `lastEmittedMd.current`. If they match,
   it's a round-trip from our own edit → skip `getMarkdown()` and `setContent()`.
   Only on genuine external changes (doc switch, Markdown-mode edit) does it call
   `setContent(value, { emitUpdate: false })`.

2. **Debounced emit**: `onUpdate` schedules `getMarkdown() + onChange()` after
   `onChangeDebounceMs` (default 150ms) of idle. Rapid keystrokes only produce one
   serialisation + one store write per pause. The timer is cancelled and rescheduled
   on every update.

3. **Flush points**: `flush()` is called synchronously on editor blur and when
   `readOnly` flips. The unmount cleanup only cancels the pending timer — to avoid
   losing the last ≤150ms of edits, the tool page calls `flush()` imperatively
   before mode switches and doc switches.

4. **Cancelled on external setContent**: If a pending debounce timer exists when an
   external value arrives, it is cancelled before `setContent()` to prevent the
   old snapshot from overwriting the new content.

### Key notes

- **Markdown round-trip**: `value` is parsed → ProseMirror doc on mount / external value
  change; the doc is serialised → markdown on every edit via `tiptap-markdown`.
- **GFM support**: headings H1-H6, paragraph, bold, italic, strikethrough, inline code,
  links, blockquote, fenced code blocks with language, bullet/ordered/task lists,
  tables, horizontal rule, images.
- **Markdown input rules** auto-convert as you type: `# `…`###### ` headings, `- `/`* `
  bullet list, `1. ` ordered list, `[ ] `/`[x] ` task list, `> ` blockquote,
  ` ``` ` fenced code block, `---` horizontal rule, plus inline `**bold**`, `*italic*`,
  `~~strike~~`, `` `code` ``, and `[text](url)` → link mark.
- **Table keyboard UX**: Tab/Shift-Tab move between cells; Tab on last cell adds a new
  row. Additional shortcuts via `linkKeyboard` extension (see below).
- **Dark mode**: tracked via `MutationObserver` on `document.documentElement.classList` —
  same pattern as `CodeEditor` and `MarkdownRenderer`.
- **External value sync**: when the `value` prop changes (e.g. doc switch), the editor
  calls `setContent(value, { emitUpdate: false })` without triggering `onChange`.
  The `lastEmittedMd` ref prevents round-trip re-syncs.
- **minimal=true use case**: inline embedding for LLM prompt inputs. No slash menu popup;
  Ctrl+K link, image/table bubble menus, markdown input rules, and full keyboard
  editing still work.

---

### Link editing (keyboard-first)

Links are keyboard-driven. The link bubble toolbar has been removed.

| Action | How |
|---|---|
| Insert a new link | `Ctrl+K` / `Cmd+K` — opens LinkPopover with Text + URL fields; Tab through fields, Enter to save, Escape to cancel |
| Edit an existing link | Place caret inside link → `Ctrl+K` — popover opens prefilled with current text + href |
| Wrap selection in link | Select text → `Ctrl+K` — popover opens with Text prefilled from selection |
| Remove link | `Ctrl+Shift+K` — unlinks immediately without a dialog |
| Insert via slash menu | Type `/link` → Enter — same popover |
| Markdown input rule | Type `[text](url)` + Space — auto-converts to a real link mark |

**After save/cancel/unlink**: editor focus is automatically returned so the user can keep typing.

**URL normalisation** (`normalizeUrl()` in `wysiwyg-utils.ts`):
- Trims whitespace.
- Empty → no-op (treated as "remove link").
- Leaves `#anchor`, `/path`, `./rel`, `../up` unchanged.
- Leaves `https://`, `mailto:`, `tel:`, `data:`, `ftp://`, etc. unchanged.
- Prepends `https://` to bare domains and `host:port` URLs.
- Blocks `javascript:` and `vbscript:` (returns `''`).

---

### Markdown link input rule

Typing `[text](url)` followed by a space (or at end of line) auto-converts the
bracket-paren syntax into a real link mark. The regex is exported as `MARKDOWN_LINK_REGEX`
for testing.

**Negative cases handled** (these are NOT converted):
- `[ ]` — task list unchecked (empty text)
- `[x]` — task list checked (single letter text)
- `[foo]` — no parenthesised URL
- `[text]()` — empty URL

---

### Image editing

The image interaction model is mouse-driven (popover via bubble menu):

1. **Inserting a new image:** type `/image` in the slash menu — a popover form appears
   with **Image URL** and **Alt text** fields.

2. **Editing an existing image:** click the image to select it. A **bubble toolbar**
   appears below with:
   - **Edit** button (reopens the popover prefilled with current src + alt)
   - **Remove** button (deletes the image node)

After save/cancel/remove, focus is returned to the editor.

---

### Table editing

Tab / Shift-Tab move between cells; Tab on last cell of last row adds a row.

**Bubble toolbar** (appears above the table when cursor is inside):

| Button | Action |
|---|---|
| Add row above | `addRowBefore()` |
| Add row below | `addRowAfter()` |
| Delete row | `deleteRow()` |
| Add column before | `addColumnBefore()` |
| Add column after | `addColumnAfter()` |
| Delete column | `deleteColumn()` |
| Delete table | `deleteTable()` |

**Keyboard shortcuts** (via `linkKeyboard` extension):

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Add row after (only inside table) |
| `Ctrl+Shift+Enter` | Add row before (only inside table) |
| `Ctrl+Alt+→` | Add column after (only inside table) |
| `Ctrl+Alt+←` | Add column before (only inside table) |
| `Ctrl+Alt+Backspace` | Delete row (only inside table) |

Shortcuts that don't match (not inside a table) return `false` so the keys fall through to other handlers.

---

### `linkKeyboard` extension

A single TipTap `Extension` registered for all non-minimal instances. Provides:
- `Mod-k` → open LinkPopover (calls `openLinkRef.current()`)
- `Mod-Shift-k` → unlink (extendMarkRange + unsetLink)
- Table keyboard shortcuts (see above)
- `[text](url)` InputRule → real link mark

---

### Bubble menu implementation notes

TipTap v3's `BubbleMenu` (from `@tiptap/react/menus`) uses **@floating-ui/dom** for
positioning — not Tippy.js. The prop is `options={{ placement: 'bottom' }}` (not
`tippyOptions`).

**Two** `BubbleMenu` instances remain (link bubble removed):

| Bubble | shouldShow condition |
|---|---|
| `imageBubble` | `e.isActive('image')` |
| `tableBubble` | `e.isActive('table') && !e.isActive('image')` |

This ensures only one bubble menu is ever visible at a time.

The link/image **popover forms** (shadcn `Popover`) are rendered separately from the
bubble toolbars — they are portalled to `<body>` by Radix UI's `PopoverPortal`.

**Anchor positioning:** The `PopoverAnchor` is a `position:fixed` invisible span whose
viewport coordinates are set at the moment the popover opens (`getSelectionRect(editor)`
in `WysiwygEditor.tsx`). Radix reads the anchor element's `getBoundingClientRect()` to
place the `PopoverContent`.

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

In minimal mode: no slash menu, but Ctrl+K link, image/table bubbles, and markdown
input rules (including `[text](url)`) all still work.

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
