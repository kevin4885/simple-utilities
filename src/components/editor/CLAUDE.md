# src/components/editor — CLAUDE.md

Shared, reusable editor components for tools that need code editing, markdown
rendering, or WYSIWYG editing.
These are hand-rolled app components — **not** shadcn/ui (which lives in `src/components/ui/`).

## Files

| File/Folder | Component / Purpose |
|---|---|
| `CodeEditor.tsx` | `<CodeEditor>` — CodeMirror 6 editor, multi-language, themed, dark-aware |
| `MarkdownRenderer.tsx` | `<MarkdownRenderer>` — react-markdown with GFM + syntax-highlighted code blocks |
| `WysiwygEditor.tsx` | Re-export shim → `./wysiwyg/WysiwygEditor` (backward compat; all imports work unchanged) |
| `wysiwyg-utils.ts` | Pure URL normaliser — `normalizeUrl()`; also re-exported from `wysiwyg/utils.ts` |
| `wysiwyg-utils.test.ts` | Vitest tests for `wysiwyg-utils.ts` |
| `wysiwyg/` | **All WYSIWYG implementation** — see layout table below |

### `wysiwyg/` folder layout

| Path | Purpose |
|---|---|
| `WysiwygEditor.tsx` | **Main component** — assembles all submodules; exports `WysiwygEditorHandle` / `WysiwygEditorProps` |
| `utils.ts` | `getSelectionRect`, `anchorRectToStyle`, re-exports `normalizeUrl` |
| `utils.test.ts` | Tests for `wysiwyg/utils.ts` |
| `extensions/linkKeyboard.ts` | `MARKDOWN_LINK_REGEX` + `buildLinkKeyboardExtension` (Mod-k, Mod-Shift-k, table shortcuts, input rule) |
| `extensions/slashCommand.tsx` | `buildSlashExtension` + `SlashMenuPortal` / `SlashMenuInner` (derives items from `SLASH_ITEMS`) |
| `forms/LinkForm.tsx` | `LinkForm` / `LinkPopover` — modal-free inline link editor |
| `forms/ImageForm.tsx` | `ImageForm` / `ImagePopover` — modal-free inline image editor |
| `menus/ImageBubble.tsx` | `ImageBubble` — BubbleMenu shown when image node is selected |
| `menus/TableBubble.tsx` | `TableBubble` — BubbleMenu for table operations (shows only on empty/CellSelection) |
| `menus/SelectionBubble.tsx` | `SelectionBubble` — floating toolbar for non-empty text selections (Phase 1 new) |
| `toolbar/config.ts` | `TOOLBAR_CONFIG`, `SLASH_ITEMS`, `HEADING_ITEMS`, `formatHotkey`, all toolbar types |
| `toolbar/config.test.ts` | Vitest tests for toolbar config invariants |
| `toolbar/Toolbar.tsx` | `Toolbar` component — renders `TOOLBAR_CONFIG` using `useEditorState` |

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
full VME tool page. Includes `TooltipProvider` internally for toolbar tooltips.

### Dependencies

- **shadcn/ui**: `popover`, `input`, `button`, `label`, `toggle`, `separator`,
  `dropdown-menu`, `tooltip` — all must be present in `src/components/ui/`.
- **@tiptap/react/menus**: `BubbleMenu` component (ships with @tiptap/react v3).
- **@tiptap/pm/state**: `TextSelection` — used by SelectionBubble/TableBubble.

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
  toolbar={true}                      // true | false | ToolbarConfig
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
| `minimal` | `boolean` | `false` | No slash menu, no toolbar. Pure keyboard surface for inline embedding. |
| `toolbar` | `boolean \| ToolbarConfig` | `true` | `true` = default toolbar; `false` = none; custom array = custom config. Ignored when `minimal=true`. |
| `onChangeDebounceMs` | `number` | `150` | Debounce delay for onChange. 0 = synchronous. |

### Imperative handle (`WysiwygEditorHandle`)

| Method | Description |
|---|---|
| `flush()` | Run getMarkdown() + onChange immediately, cancelling any pending debounce. |

**Call `flush()` before**:
- Switching away from wysiwyg mode (so the store has the latest markdown before the editor unmounts)
- Doc switching
- Any action that reads `activeDoc.content` right after editor changes

---

## Toolbar (Phase 1)

### Data-driven config — `wysiwyg/toolbar/config.ts`

```ts
interface ToolbarItem {
  id: string
  title: string
  icon: LucideIcon
  hotkey?: string              // display string e.g. 'Ctrl+B'
  exec: (editor: Editor, actions?: ToolbarActions) => void
  isActive?: (editor: Editor) => boolean
  isEnabled?: (editor: Editor) => boolean
  keywords?: string[]
  description?: string
}
interface ToolbarListButton {
  id: string; title: string; icon: LucideIcon; type: 'list'; items: ToolbarItem[]
}
type ToolbarGroup = (ToolbarItem | ToolbarListButton)[]
type ToolbarConfig = ToolbarGroup[]

interface ToolbarActions {
  openLink?: () => void
  openImage?: () => void
}
```

`exec` receives `(editor, actions?)`. Link/image items call `actions?.openLink?.()` /
`actions?.openImage?.()` — this keeps popover openers injectable, not hardcoded. Later
phases will swap these for widgetForm anchors without changing config items.

`formatHotkey(pattern: string)` returns Cmd on Mac, Ctrl elsewhere.

### Adding a toolbar item

1. Add a new `ToolbarItem` object to the appropriate group in `TOOLBAR_CONFIG`.
2. Set a unique `id`, `title`, `icon` (lucide-react), `exec`.
3. If it needs link/image popovers, use `actions?.openLink?.()` in exec.
4. The item is automatically included in `SLASH_ITEMS` (unless its `id` is `'undo'` or `'redo'`).
5. If it's a group dropdown, add a `ToolbarListButton` with `type: 'list'`.

### Default toolbar groups

| Group | Items |
|---|---|
| History | undo, redo |
| Inline marks | bold, italic, strikethrough, inlineCode |
| Block structure | heading▾ (paragraph, H1–H6), list▾ (bullet, ordered, task, indent, outdent), link, blockquote, code▾ (inline, block) |
| Insert | image, table, horizontalRule |

### Toolbar rendering — `wysiwyg/toolbar/Toolbar.tsx`

Uses `useEditorState({ editor, selector })` to compute active/enabled flags in ONE
selector, so the toolbar only re-renders when flags actually change (not every keystroke).

Groups separated by vertical Separators. ToolbarItem → shadcn `Toggle` (sm).
ToolbarListButton → shadcn `DropdownMenu`. Every button wrapped in shadcn `Tooltip`.

The toolbar is `sticky top-0 z-10` inside `wysiwyg-root` — stays visible as the editor scrolls.

---

## Selection toolbar (Phase 1)

`wysiwyg/menus/SelectionBubble.tsx` — a third BubbleMenu (pluginKey `selectionBubble`).

### shouldShow rules (mirrors gravity-ui SelectionContext):
- Selection is non-empty AND is a `TextSelection` (not `NodeSelection` or `CellSelection`)
- Editor is focused
- Neither `$from` nor `$to` parent is a `codeBlock`
- Not inside an image
- Mouse button is NOT held down (suppressed on `mousedown`, re-evaluated on `mouseup`)

### Mutual exclusivity:
- **ImageBubble** — shows only for image `NodeSelection` (never a `TextSelection`)
- **TableBubble** — shows only for empty cursor or `CellSelection` inside a table
- **SelectionBubble** — shows for non-empty `TextSelection` anywhere else

### Contents:
Heading/paragraph dropdown, bold/italic/strike/inline-code toggles, link button.

---

## Link editing (keyboard-first)

Links are keyboard-driven. The link bubble toolbar has been removed.

| Action | How |
|---|---|
| Insert a new link | `Ctrl+K` / `Cmd+K` — opens LinkPopover with Text + URL fields |
| Edit an existing link | Place caret inside link → `Ctrl+K` |
| Wrap selection in link | Select text → `Ctrl+K` |
| Remove link | `Ctrl+Shift+K` — unlinks immediately |
| Insert via slash menu | Type `/link` → Enter |
| Via selection toolbar | Select text → click Link button |
| Markdown input rule | Type `[text](url)` + Space |

---

## Image editing

1. **Inserting a new image:** type `/image` in the slash menu (or toolbar Image button)
2. **Editing an existing image:** click to select → bubble toolbar appears:
   - **Edit** button — reopens the popover prefilled with current src + alt
   - **Remove** button — deletes the image node

---

## Table editing

Tab / Shift-Tab move between cells; Tab on last cell of last row adds a row.

**Bubble toolbar** (cursor inside table, empty selection only):
add row above/below, delete row, add column before/after, delete column, delete table.

**Keyboard shortcuts** (via `linkKeyboard` extension):
`Ctrl+Enter` (add row after), `Ctrl+Shift+Enter` (add row before),
`Ctrl+Alt+→/←` (add col after/before), `Ctrl+Alt+Backspace` (delete row).

---

## URL normalisation

`normalizeUrl()` in `wysiwyg-utils.ts` (also re-exported from `wysiwyg/utils.ts`):
- Trims whitespace. Empty → `''`.
- Leaves `#anchor`, `/path`, `./rel`, `../up` unchanged.
- Leaves `https://`, `mailto:`, `tel:`, `data:`, `ftp://` etc. unchanged.
- Prepends `https://` to bare domains and `host:port`.
- Blocks `javascript:` and `vbscript:` (returns `''`).

---

## Markdown link input rule (`MARKDOWN_LINK_REGEX`)

Typing `[text](url)` + space auto-converts to a real link mark.
Exported from `wysiwyg/extensions/linkKeyboard.ts` and re-exported from `WysiwygEditor.tsx`.

Negative cases NOT converted: `[ ]`, `[x]`, `[foo]` (no URL), `[text]()` (empty URL).

---

## Bubble menu implementation notes

TipTap v3's `BubbleMenu` uses **@floating-ui/dom** for positioning. Prop: `options={{ placement: '...' }}`.

**Three** BubbleMenu instances (only one ever visible at a time):

| Bubble | `pluginKey` | `shouldShow` condition |
|---|---|---|
| `imageBubble` | `'imageBubble'` | `e.isActive('image')` |
| `tableBubble` | `'tableBubble'` | inside table AND (empty selection OR CellSelection) AND not image |
| `selectionBubble` | `'selectionBubble'` | non-empty TextSelection AND focused AND not codeBlock AND not image AND not mouseDown |

---

## Adding a new language

**CodeEditor:** add to `LANG_EXTENSIONS` map in `CodeEditor.tsx`.

**MarkdownRenderer:** add to `SUPPORTED_LANGUAGES` set and register with
`SyntaxHighlighter.registerLanguage(...)` at the top of `MarkdownRenderer.tsx`.

**WysiwygEditor:** no config needed — code blocks render as `<pre class="wysiwyg-code-block">`.
