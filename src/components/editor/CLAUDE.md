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
| `wysiwyg/` | **All WYSIWYG implementation** — see layout table below |

### `wysiwyg/` folder layout

| Path | Purpose |
|---|---|
| `WysiwygEditor.tsx` | **Main component** — assembles all submodules; exports `WysiwygEditorHandle` / `WysiwygEditorProps` |
| `WysiwygErrorBoundary.tsx` | **Error boundary** — class component wrapping `<WysiwygEditor>` usage; on crash flushes pending edits, calls `onError` prop, renders `null` (page manages crash banner); see Phase 4 section below |
| `coreExtensions.ts` | `buildCoreExtensions(opts?)` — single source of truth for all serialisation-relevant extensions; imported by both `WysiwygEditor.tsx` and `testUtils.ts` |
| `utils.ts` | `normalizeUrl()` + `sanitizeImageSrc()` + `getScrollParent()` + `getLinkRange(state)` — URL sanitisation, nearest-scrollable-ancestor finder, link mark range helper |
| `utils.test.ts` | Tests for `wysiwyg/utils.ts` (full normalizeUrl suite + sanitizeImageSrc + getLinkRange + autolink round-trip) |
| `extensions/linkKeyboard.ts` | `MARKDOWN_LINK_REGEX` + `buildLinkKeyboardExtension` (Mod-k, Mod-Shift-k, table shortcuts, input rule) |
| `extensions/slashCommand.tsx` | `buildSlashExtension` + `SlashMenuPortal` / `SlashMenuInner` (derives items from `SLASH_ITEMS`) |
| `extensions/widgetForm.ts` | `widgetFormExtension` — ProseMirror plugin; in-document widget chip decorations; see below |
| `extensions/tableInvariant.ts` | `tableInvariantExtension` — ProseMirror `appendTransaction` plugin; enforces GFM header-row invariant on every doc-changing transaction |
| `forms/LinkForm.tsx` | `LinkForm` — pure form component for inserting/editing links (no popover wrapper) |
| `forms/ImageForm.tsx` | `ImageForm` — pure form component for inserting/editing images + drag-and-drop file picker |
| `forms/TableForm.tsx` | `TableForm` — 8×8 grid picker for table insertion (Phase 2) |
| `forms/WidgetPopover.tsx` | `WidgetPopover` — React popover anchored to in-document chip via Radix `virtualRef` |
| `forms/imageFile.ts` | Pure helpers: `fileToDataUri`, `isImageFile`, `formatBytes`, `SIZE_WARNING_BYTES` |
| `forms/imageFile.test.ts` | Unit tests for `imageFile.ts` |
| `forms/tableGrid.ts` | Pure `nextSize(size, key)` reducer for table grid keyboard navigation |
| `forms/tableGrid.test.ts` | Unit tests for `tableGrid.ts` |
| `menus/ImageBubble.tsx` | `ImageBubble` — BubbleMenu shown when image node is selected |
| `menus/SelectionBubble.tsx` | `SelectionBubble` — floating toolbar for non-empty text selections (Phase 1) |
| `extensions/tableControls/` | **Phase 3** — gravity-ui-style table controls; see table-controls section below |
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
  `dropdown-menu`, `tooltip`, `checkbox` — all must be present in `src/components/ui/`.
- **@tiptap/react/menus**: `BubbleMenu` component (ships with @tiptap/react v3).
- **@tiptap/pm/state**: `TextSelection` — used by SelectionBubble.

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
  openTable?: () => void   // Phase 2: opens table grid picker widget
}
```

`exec` receives `(editor, actions?)`. Link/image/table items call the corresponding
action callback — this keeps popover openers injectable, not hardcoded.

`formatHotkey(pattern: string)` returns Cmd on Mac, Ctrl elsewhere.

### Adding a toolbar item

1. Add a new `ToolbarItem` object to the appropriate group in `TOOLBAR_CONFIG`.
2. Set a unique `id`, `title`, `icon` (lucide-react), `exec`.
3. If it needs link/image/table widgets, use `actions?.openLink?.()` / `actions?.openImage?.()` / `actions?.openTable?.()` in exec.
4. The item is automatically included in `SLASH_ITEMS` (unless its `id` is `'undo'` or `'redo'`).
5. If it's a group dropdown, add a `ToolbarListButton` with `type: 'list'`.

### Default toolbar groups

| Group | Items |
|---|---|
| History | undo, redo |
| Inline marks | bold, italic, strikethrough, inlineCode |
| Block structure | heading▾ (paragraph, H1–H6), list▾ (bullet, ordered, task, indent, outdent), link, blockquote, code▾ (inline, block) |
| Insert | image, table (grid picker), horizontalRule |

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
- **SelectionBubble** — shows for non-empty `TextSelection` anywhere else
- **TableControls overlay** (Phase 3) — absolute-positioned, coexists with any selection state

### Contents:
Heading/paragraph dropdown, bold/italic/strike/inline-code toggles, link button.

---

## Widget Form system (Phase 2)

### Design rationale

The Phase 1 `LinkPopover`/`ImagePopover` used `getSelectionRect()` + `position:fixed` spans
as anchors. Problem: the rect is a one-time snapshot. If the editor scrolls after the popover
opens, the popover detaches from the caret.

Phase 2 replaces this with a gravity-ui inspired approach: a ProseMirror `Decoration.widget()`
is inserted at the caret position, rendering a visible chip (`<span class="wysiwyg-widget-anchor">`).
A Radix `PopoverAnchor` with `virtualRef` pointing at this chip element lets floating-ui track
its position automatically on scroll/resize.

### widgetFormExtension (`extensions/widgetForm.ts`)

A TipTap `Extension` wrapping a ProseMirror Plugin that holds a `DecorationSet`.

**Plugin state**: `{ decorations: DecorationSet, active: { id, kind, mode, dom, selectionFrom, selectionTo, rangeFrom, rangeTo, nodePos? } | null }`

Decorations are mapped through `tr.mapping` on every transaction, so if the user types
before saving, the chip moves with the document. If the block containing the chip is deleted,
`active` is cleared automatically (chip and range modes only — node mode carries no decoration).

**Anchor modes** — chosen when opening a form:

| Mode | Decoration | When used | dom resolution |
|------|-----------|-----------|----------------|
| `chip` | `Decoration.widget()` at `selection.from` | Link/image/table when selection is empty AND not inside an existing link/image | Immediately (chip element built at open time) |
| `range` | `Decoration.inline(from, to, { class: 'wysiwyg-link-target' })` | Link when selection is non-empty OR cursor is inside an existing link mark | Lazy — `view.dom.querySelector('.wysiwyg-link-target')` in plugin view's `update()` |
| `node` | None | Image when `editor.isActive('image')` (editing an existing image) | Lazy — `view.nodeDOM(nodePos)` in plugin view's `update()` |

In range and node modes, the plugin view's `update()` resolves `dom` lazily after ProseMirror
renders. Storage subscribers are only notified once `dom` is non-null.

`openLinkWidget` falls back to `chip` if the computed range is zero-width (mark/state desync guard).

**Meta actions** (dispatched via `tr.setMeta(widgetFormKey, action)`):
- `{ type: 'open', kind, id, mode, dom?, rangeFrom?, rangeTo?, nodePos? }` — opens widget with chosen mode
- `{ type: 'close', id }` — removes decoration and clears active

**Storage** (`editor.storage.widgetForm`):
```ts
interface WidgetFormStorage {
  active: ActiveWidget | null
  subscribe(cb: (active: ActiveWidget | null) => void): void
  unsubscribe(cb: ...): void
}
interface ActiveWidget {
  id: string
  kind: 'link' | 'image' | 'table'
  mode: 'chip' | 'range' | 'node'
  dom: HTMLElement | null  // null until lazily resolved (range/node modes)
  selectionFrom: number    // snapshot of selection.from at open time
  selectionTo: number      // snapshot of selection.to at open time
  rangeFrom: number        // decoration range from (= selectionFrom for chip)
  rangeTo: number          // decoration range to (= selectionTo for chip)
  nodePos?: number         // node mode: document position of the image node
  getPos(): number | null  // chip mode only — current chip pos from DecorationSet
}
```

**TipTap commands**:
- `editor.commands.openWidgetForm(kind, opts?)` — opens widget; opts: `{ mode?, rangeFrom?, rangeTo?, nodePos? }`
- `editor.commands.closeWidgetForm()` — dispatches `close` meta, refocuses editor

**Escape handling**: plugin `handleKeyDown` closes active widget on Escape.

**opener helpers** in `WidgetPopover.tsx`:
- `openLinkWidget(editor)` — `range` when `!selection.empty || isActive('link')` (fallback to `chip` if range is zero-width), else `chip`
- `openImageWidget(editor)` — `node` when `isActive('image')`, else `chip`
- `openTableWidget(editor)` — always `chip`

**Close restores selection**: `handleClose` restores the original `TextSelection` (or `NodeSelection` for node mode) before focusing so Cancel doesn't lose the user's caret/selection.

### WidgetPopover (`forms/WidgetPopover.tsx`)

React component. Subscribes to `editor.storage.widgetForm` via `subscribe/unsubscribe`.
When `active !== null`, renders a Radix `Popover` with:
- `PopoverAnchor virtualRef={{ current: active.dom }}` → Radix + floating-ui track the chip
- `PopoverContent` routed to `LinkForm` / `ImageForm` / `TableForm` by `active.kind`

The `virtualRef` is kept in a `useRef<Measurable>` updated via `useLayoutEffect` (not during render).

### Forms

**LinkForm** — text + URL fields. Save semantics:
- Range mode (`rangeFrom !== rangeTo`, decoration spans highlighted text) → replaces `rangeFrom..rangeTo` with linked text
- Non-empty selection (chip mode) → replaces selection with linked text
- Caret in existing link (`editor.isActive('link')`, chip mode) → `extendMarkRange` then replace
- Empty cursor (chip mode) → insert new text with link mark at cursor
- Empty href on active link → unlink (`extendMarkRange` + `unsetLink`)

**ImageForm** — URL + Title (optional) + Alt text fields + drag-and-drop/file picker.
- Files are read as base64 data: URIs via `FileReader` (no backend).
- Files > 1 MiB show a size warning.
- **Title field**: shown between URL and Alt, labelled "Title (optional)". Passed as the `title`
  attribute on the image node. Round-trips through tiptap-markdown as `![alt](src "title")`.
  Empty title is excluded (`title || undefined`) so no spurious title appears in markdown.
  Prefilled from `editor.getAttributes('image').title` in edit mode.
- **Width/height deliberately excluded**: GFM markdown has no image size syntax; dimensions cannot round-trip through tiptap-markdown's markdown serialiser. Use HTML embed if you need sized images.

**TableForm** — 8×8 grid picker.
- Hover/click to select dimensions; arrow keys for keyboard navigation.
- Tables are always inserted with `withHeaderRow: true` — the "Header row" checkbox has been removed (GFM tables always have a header row; inserting without one breaks the serialiser invariant).
- Enter inserts, Escape cancels.
- Pure reducer `nextSize(size, key)` in `forms/tableGrid.ts` handles clamped navigation.

### Paste/drop images

`WysiwygEditor` has `editorProps.handlePaste` and `handleDrop`:
- If clipboard items / dropped files contain an image/* MIME type, reads as data URI and inserts `<img>`.
- Text paste is unchanged (returns false, ProseMirror handles it).

---

## Link editing (keyboard-first)

Links are keyboard-driven. The link bubble toolbar has been removed.

| Action | How |
|---|---|
| Insert a new link | `Ctrl+K` / `Cmd+K` — opens WidgetPopover with Text + URL fields |
| Edit an existing link | Place caret inside link → `Ctrl+K` |
| Wrap selection in link | Select text → `Ctrl+K` (or toolbar Link button, or SelectionBubble Link button) |
| Remove link | `Ctrl+Shift+K` — unlinks immediately |
| Insert via slash menu | Type `/link` → Enter |
| Via selection toolbar | Select text → click Link button |
| Markdown input rule | Type `[text](url)` + Space |

---

## Image editing

1. **Inserting a new image:** type `/image` in the slash menu (or toolbar Image button)
   → `WidgetPopover` opens with URL + alt fields + drop zone
2. **Drag/paste image file:** drop or paste an image file directly onto the editor → inserted as data URI
3. **Editing an existing image:** click to select → ImageBubble appears:
   - **Edit** button — reopens WidgetPopover prefilled with current src + alt
   - **Remove** button — deletes the image node

**ImageForm** — URL + Title (optional) + Alt text fields + drag-and-drop/file picker.
- Drag/paste image file directly → inserted as data URI
- **Editing an existing image:** click to select → ImageBubble appears:
   - **Edit** button — reopens WidgetPopover (`node` anchor mode) prefilled with current src + alt + title
   - **Remove** button — deletes the image node

**Width/height constraint**: Not exposed in the image form. GFM markdown has no image size syntax
(gravity-ui's `=WxH` YFM extension is not GFM). Dimensions cannot survive the tiptap-markdown
round-trip. Use a raw HTML `<img>` embed if you need sized images.

---

## Table editing

**Insert via widget picker (Phase 2):**
- Toolbar Table button → WidgetPopover opens with 8×8 grid picker
- Slash command `/table` → same grid picker
- Choose dimensions by hovering/clicking or arrow keys + Enter
- Tables are always inserted with `withHeaderRow: true` — no checkbox

Tab / Shift-Tab move between cells; Tab on last cell of last row adds a row. Enter moves to the cell below (same column, next row); on the last row it adds a new row first. Shift-Enter is a no-op in table cells (hard breaks in cells break tiptap-markdown serialisation).

**Hover controls (Phase 3 — see tableControls section below):**
- Row handle pill (left edge of hovered row): insert above/below, move up/down, delete row *(disabled on header row)*, delete table.
- Column handle pill (top edge of hovered column): insert left/right, move left/right, delete column, delete table.
- "Toggle header row" has been removed — GFM tables always have exactly one header row.
- Edge "+" buttons: append column (right edge), append row (bottom edge).
- Focused table gets a subtle ring outline (`wysiwyg-table-focused` decoration class).

**Keyboard shortcuts** (via `linkKeyboard` extension):
`Enter` (move to cell below / add row), `Shift-Enter` (no-op in cell — hard breaks break serialisation; `linkKeyboard` priority:1000 pre-empts StarterKit's HardBreak so no hardBreak node is ever inserted in a cell),
`Ctrl+Enter` (add row after), `Ctrl+Shift+Enter` (add row before),
`Ctrl+Alt+→/←` (add col after/before), `Ctrl+Alt+Backspace` (delete row).

---

## URL normalisation

`normalizeUrl()` in `wysiwyg/utils.ts` (also re-exported from `WysiwygEditor.tsx`):
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

**Two** BubbleMenu instances (Phase 3 removed `tableBubble`):

| Bubble | `pluginKey` | `shouldShow` condition |
|---|---|---|
| `imageBubble` | `'imageBubble'` | `e.isActive('image')` |
| `selectionBubble` | `'selectionBubble'` | non-empty TextSelection AND focused AND not codeBlock AND not image AND not mouseDown |

---

## Adding a new language

**CodeEditor:** add to `LANG_EXTENSIONS` map in `CodeEditor.tsx`.

**MarkdownRenderer:** add to `SUPPORTED_LANGUAGES` set and register with
`SyntaxHighlighter.registerLanguage(...)` at the top of `MarkdownRenderer.tsx`.

**WysiwygEditor:** no config needed — code blocks render as `<pre class="wysiwyg-code-block">`.


---

## Table controls (Phase 3)

TableBubble (7-button BubbleMenu) has been removed and replaced with
gravity-ui/Notion-style in-place controls.

### wysiwyg/extensions/tableControls/ layout

| File | Purpose |
|---|---|
| plugin.ts | ProseMirror plugin — focused-table decoration, throttled hover tracking, tableControlsKey |
| commands.ts | Pure helpers: selectRow, selectColumn, moveRow, moveColumn, isRectangularTable, getEditorTablePos |
| TableControls.tsx | React overlay — row/column handle pills + edge "+" buttons |
| index.ts | tableControlsExtension TipTap Extension; re-exports tableControlsKey, setDropdownOpen, commands |
| commands.test.ts | Vitest tests for commands + throttle utility |

### Plugin state (tableControlsKey.getState(state))

```ts
interface TableControlsState {
  tablePos: number | null    // pos of table node containing selection, or null
  hover: { rowIdx: number; colIdx: number } | null  // hovered cell
  menuOpen: boolean          // true while a row/column dropdown is open (per-instance)
  decorations: DecorationSet  // focused outline + data-row-handle / data-col-handle attrs
}
```

### How it works

1. **Focus decoration**: when selection is inside a table, Decoration.node adds wysiwyg-table-focused class (subtle ring outline).
2. **Hover tracking**: throttled (100 ms) mousemove resolves the cell under the pointer via posAtCoords + walking up to tableCell/tableHeader + TableMap.findCell. Dispatches tr.setMeta(tableControlsKey, { type: 'hover', rowIdx, colIdx }). mouseleave clears after 150 ms grace.
3. **Handle decorations**: when hover is set, Decoration.node adds data-row-handle attr to the first cell of the hovered row, and data-col-handle attr to the first-row cell in the hovered column. These are queried by TableControls.tsx to measure handle positions.
4. **React overlay** (TableControls.tsx): subscribed to editor transaction events; re-measures rects on scroll/resize. Renders handle pills and edge "+" buttons using absolute positioning inside wysiwyg-root. Uses `getScrollParent(editor.view.dom)` (from `utils.ts`) to find the nearest scrollable ancestor — not `closest('.overflow-y-auto')` which was coupled to Tailwind class names.
5. **Dropdown blur guard**: all handle buttons use onMouseDown={e=>e.preventDefault()} to prevent editor blur. Menus use onCloseAutoFocus to refocus the editor.
6. **Dropdown-open freeze**: setDropdownOpen(true) is called when a row/col menu opens, so the mousemove handler ignores events while a menu is displayed.
7. **Hover-persist fix**: when a menu closes (`onOpenChange(false)`) and the pointer is not over the editor DOM (`!editor.view.dom.matches(':hover')`), the hover-clear meta is dispatched immediately. This handles the case where the Radix dropdown portal is outside the editor DOM — the pointer never re-enters, so mousemove never fires to clear hover organically. **Manual-check note**: verified visually — no unit test because the fix depends on real pointer coordinates and DOM layout (`:hover` pseudo-class is not testable in jsdom).

### Handles

**Row handle** (6×22px pill at tableRect.left - 14px, vertically centered on [data-row-handle] cell):
- Click opens DropdownMenu: Insert row above *(disabled on header row)*, Insert row below, Move row up *(disabled if rowIdx ≤ 1 or non-rectangular)*, Move row down *(disabled if rowIdx === 0 (header) or last row or non-rectangular)*, Delete row *(disabled on header row)*, Delete table.
- "Toggle header row" has been removed — GFM tables always have a header row; removing it would break the serialiser invariant.

**Column handle** (22×6px pill at tableRect.top - 14px, horizontally centered on [data-col-handle] cell):
- Click opens DropdownMenu: Insert column left, Insert column right, Move column left *(disabled if first col or non-rectangular)*, Move column right *(disabled if last col or non-rectangular)*, Delete column, Delete table.

**Edge "+" buttons** (20×20px round):
- Right edge: Append column (addColumnAfter)
- Bottom edge: Append row (addRowAfter)

### Move operations

moveRow / moveColumn delegate to prosemirror-tables' moveTableRow / moveTableColumn commands.
GFM tables are always rectangular (no colspan/rowspan), but both commands guard via isRectangularTable
(checks TableMap.problems). Move items are disabled when the table is non-rectangular.

### Spans limitation

Colspan/rowspan > 1 tables (not producible by GFM markdown) disable Move row/column items.
Insert/delete/toggle-header still work regardless.

### CSS classes

| Class | Applied to | Purpose |
|---|---|---|
| wysiwyg-table-focused | table node | 1px ring outline via outline |
| wysiwyg-table-handle | handle pill buttons | Pill base style (bg-border, rounded-full) |
| wysiwyg-table-row-handle | row pill | Additional targeting |
| wysiwyg-table-col-handle | col pill | Additional targeting |
| wysiwyg-table-plus-btn | edge "+" buttons | bg-background border shadow |

### Keyboard shortcuts (unchanged from Phase 2)

All table keyboard shortcuts defined in extensions/linkKeyboard.ts remain:
Ctrl+Enter (add row after), Ctrl+Shift+Enter (add row before),
Ctrl+Alt+→/← (add col after/before), Ctrl+Alt+Backspace (delete row).
Tab / Shift-Tab cell navigation is handled by prosemirror-tables.

---

## Phase 4 additions

### Autolink / linkOnPaste

`Link.configure({ autolink: true, linkOnPaste: true })` in `WysiwygEditor.tsx`:
- **autolink**: typing `https://example.com ` (URL followed by space/newline) auto-converts it to a link mark.
  - tiptap-markdown serialises an autolinked URL as **`<url>`** (GFM autolink form, via prosemirror-markdown's `isPlainURL` check) when the link text equals the href and the href has a scheme. A regular link with distinct text serialises as `[text](href)`.
- **linkOnPaste**: pasting a URL over a selection links the selected text.
- **linkify: false** is kept in `Markdown.configure` intentionally — we do NOT want the markdown parser to re-linkify plain-text URLs on every parse pass (that would silently mutate the user's source on each load).
- **Suppressing autolink on programmatic setContent**: the value-sync `useEffect` uses `editor.chain().setMeta('preventAutolink', true).setContent(value, { emitUpdate: false }).run()` — this prevents the autolink appendTransaction from rewriting URLs in the first block when loading external content. The `preventAutolink` meta key is checked by the tiptap Link extension's appendTransaction (verified in `@tiptap/extension-link/dist/index.js`).

### allowBase64 on Image extension

`Image.configure({ allowBase64: true, … })` — enables data-URI images to survive the parse → serialise round-trip. With `allowBase64: false` (the old default), `parseHTML` filters out `img[src^="data:"]` nodes, silently deleting file-drop/paste images on the next `setContent` call.

### Error boundary (`wysiwyg/WysiwygErrorBoundary.tsx`)

A class-component error boundary wrapping **only the wysiwyg panel** in the VME page.
On error: logs, flushes pending edits, calls `onError` (page switches mode + shows banner), renders `null`.
There is **no inline fallback notice** in the boundary — the page manages a `wysiwygError` banner state.

**Usage (correct pattern):**
```tsx
import { WysiwygErrorBoundary } from '@/components/editor/wysiwyg/WysiwygErrorBoundary'

// wysiwygError: boolean state + setWysiwygError in parent
// Wrap ONLY the wysiwyg panel — not the full editor area.
// The boundary unmounts when mode switches to 'markdown', so it
// remounts clean when the user retries 'wysiwyg'.

{mode === 'wysiwyg' && (
  <WysiwygErrorBoundary
    flushRef={wysiwygRef}
    onError={() => { setEditorMode('markdown'); setWysiwygError(true) }}
  >
    <WysiwygEditor ref={wysiwygRef} … />
  </WysiwygErrorBoundary>
)}

{/* Crash banner — shown above editor area when wysiwygError */}
{wysiwygError && (
  <div role="alert" …>
    The visual editor hit a problem…
    <button onClick={() => { setWysiwygError(false); setEditorMode('wysiwyg') }}>
      Try visual mode again
    </button>
  </div>
)}

{mode === 'markdown' && <CodeEditor … />}
```

**Note**: `onReset` prop removed. No reset plumbing needed — boundary remounts automatically when mode returns to `'wysiwyg'`.

**Note**: boundary lives at the **page level** (VME tool), not inside WysiwygEditor itself.

### GFM header-row invariant (tableInvariant + tableControls)

GFM tables always have exactly one header row (row 0 = all `tableHeader` nodes; rows 1+ = all `tableCell` nodes). tiptap-markdown's `isMarkdownSerializable` check enforces this. Violated tables fall back to the HTML serialiser which, with `html: false`, emits `[table]`.

**Document-level enforcement (primary defence):**
`extensions/tableInvariant.ts` — a `tableInvariantExtension` ProseMirror plugin with `appendTransaction`. On any doc-changing transaction it walks all table nodes and repairs three classes of violations:

1. **Cell-type violations**: cells with the wrong type (header in body row, cell in header row) are fixed via `setNodeMarkup`.
2. **Cell-content violations**: every cell must contain exactly one `paragraph` child. Cells with `childCount !== 1` or a non-paragraph first child are normalised:
   - Multiple children (e.g. two paragraphs from a splitBlock/Enter-in-cell): text joined with a single space into one paragraph. Inline marks lost — acceptable; prevents `[table]` content loss.
   - Single non-paragraph child (list, heading pasted in): flattened to a paragraph containing the cell's plain `textContent`. Inline marks lost — acceptable fallback.
   - Empty cell: an empty paragraph is inserted.
3. **hardBreak violations**: any `hardBreak` node inside a cell paragraph is replaced with a single space text node. This closes the HTML paste path (`<td>x<br>y</td>` → paragraph with a `hardBreak` inline) — tiptap-markdown cannot serialise a `hardBreak` inside a GFM cell and would emit the literal `[hardBreak]`.

All fixes are marked `addToHistory: false`. The plugin is idempotent: after one fix the next pass finds no violations and returns `null`.

**What the invariant does NOT cover:**
- `colspan`/`rowspan` > 1: not reachable from the UI (GFM has no span syntax; `mergeCells` is not exposed). `isRectangularTable()` still gates Move row/column.
- Content arriving via `setContent` is repaired on the next doc-changing transaction. The Markdown parser never produces invalid tables, so only direct ProseMirror manipulation is affected.

**Keymap priority — `linkKeyboard` extension (`priority: 1000`):**
StarterKit's HardBreak extension (default priority 100) also binds `Shift-Enter`. TipTap registers extension keymaps in descending priority order, so `linkKeyboard` (priority 1000) runs first. Inside a table cell, the `Shift-Enter` handler returns `true` (no-op), consuming the event before HardBreak can insert a `hardBreak` node. Outside a table cell the handler returns `false`, so HardBreak still fires normally everywhere else. The `priority: 1000` field is set on the `Extension.create(…)` in `extensions/linkKeyboard.ts`.

**UX guards (secondary defence — convenience, not correctness):**
- Tables are **always inserted with `withHeaderRow: true`** — the "Header row" checkbox has been removed from `TableForm`.
- **"Insert row above"** is disabled when `rowIdx === 0` in the menu (still works via keyboard; invariant corrects the result).
- **"Delete row"** is disabled when `rowIdx === 0` in the menu (still works via keyboard; invariant corrects the result).
- **"Move row up"** is disabled when `rowIdx <= 1` (row 1 cannot move above the header; row 0 is the header).
- **"Move row down"** is disabled when `rowIdx === 0` (header must never move).
- **"Toggle header row"** has been removed — not a valid GFM operation.
- `moveRow()` in `commands.ts` returns `false` (and leaves the doc unchanged) if `fromIdx === 0` or `toIdx === 0`.
- Column operations (insert/delete/move) are always safe — they preserve row types.

### Per-instance dropdown state (tableControls plugin)

The module-level `_dropdownOpen` flag has been replaced with `menuOpen: boolean` in the ProseMirror plugin state. This makes the flag per-editor-instance (no global pollution when multiple editors mount).

- `setDropdownOpen(editor, open)` dispatches `{ type: 'menu', open }` meta on `editor.view`. The plugin `apply()` handles this meta separately from `hover` metas.
- `TableControls.tsx` calls `setDropdownOpen(editor, rowOpen || colOpen)` in `handleRowOpenChange`/`handleColOpenChange`.
- `mouseleave` returns early when `pluginState.menuOpen` is true; the 150ms timer also rechecks before clearing.
- `destroy()` no longer needs to reset a global flag.

**Row/col index snapshot:** `TableControls` snapshots `rowIdx`/`colIdx` into `rowMenuTarget`/`colMenuTarget` React state when a menu opens. All menu-action callbacks use the snapshot instead of live hover values, preventing Radix portal mouse-leave from changing the target index between open and click.

### testUtils (`wysiwyg/testUtils.ts`) and coreExtensions (`wysiwyg/coreExtensions.ts`)

`wysiwyg/coreExtensions.ts` is the **single source of truth** for all serialisation-relevant extensions. It exports `buildCoreExtensions()` (no options — `allowBase64` is always `true` and is a constant) which is imported by:
- `WysiwygEditor.tsx` — spread into the `useMemo` extensions array (+ ref/UI-dependent extensions appended after)
- `testUtils.ts` — used by `createTestEditor` so test editor configs can never diverge from production

`wysiwyg/testUtils.ts` re-exports `buildCoreExtensions` and adds headless test helpers:
- `buildCoreExtensions()` — re-exported from `coreExtensions.ts`
- `createTestEditor(markdown)` — headless `Editor` with that config, pre-loaded with `markdown`
- `getMarkdown(editor)` — serialises via tiptap-markdown storage

**Canonical import path for tests:** always import from `./testUtils` (or the relative equivalent). Never import `buildCoreExtensions` directly from `coreExtensions` in tests — use `testUtils` as the single test-layer import point.

**All new tests that need a headless editor MUST use `createTestEditor`** — not hand-rolled extension arrays that can silently diverge from the component config. No test under `src/components/editor/**` may configure StarterKit/Table/Markdown/Link/Image directly.

### Split mode

Split mode is implemented entirely in the VME page (`tools/writing/visual-markdown-editor/index.tsx`) — it is NOT a WysiwygEditor feature. Split renders a `ResizablePanelGroup` with `CodeEditor` (left) and `MarkdownRenderer` (right). Below `md` breakpoint the direction switches to `vertical` via the `useMediaQuery('(min-width: 768px)')` hook in `src/lib/useMediaQuery.ts`.

The panel group is keyed on orientation (`key={isDesktop ? 'split-h' : 'split-v'}`) so `react-resizable-panels` remounts cleanly if it cannot change direction at runtime.

The VME page uses a **single unified layout**: the editor area is rendered once (not duplicated in a hidden desktop + mobile block). The desktop vs mobile difference is only whether the collapsible right-panel doc list is shown (controlled by `isDesktop`).

**Mode ids / labels / titles / order** live in `EDITOR_MODES` in the VME `logic.ts` (React-free single source of truth; `getModeLabel()` reads from it). `index.tsx` only adds the Lucide icon per id (`modeIcons`) and maps over `EDITOR_MODES` to render the toggle.

**Adding a mode** (one change per location):
1. Add one entry to `EDITOR_MODE_IDS` in `logic.ts` (derives `EditorModeId` type)
2. Add one `EditorModeMeta` row to `EDITOR_MODES` in `logic.ts` (label, title)
3. Add one icon entry to `modeIcons` in `index.tsx`
4. `store.ts` derives `EditorModeSchema` automatically from `EDITOR_MODE_IDS` via `z.enum(EDITOR_MODE_IDS)` — no change needed there.

### Preview toggle keyboard shortcut

**`Ctrl+Alt+P` / `Cmd+Alt+P`** — toggles between the current editing mode and Preview, remembering the previous mode to return to.

`Ctrl+Shift+P` is NOT used — that keystroke opens Firefox's New Private Window and cannot be prevented.

### Image src sanitisation

Every code path that inserts or updates an image `src` must call `sanitizeImageSrc(src)` from `wysiwyg/utils.ts` before passing to `setImage`/`updateAttributes`:
- `WidgetPopover.tsx handleImageSave` — calls `sanitizeImageSrc`
- `WysiwygEditor.tsx handlePaste` / `handleDrop` — calls `sanitizeImageSrc` on the data URI

`sanitizeImageSrc` passes `data:image/*` and `blob:` URIs through unchanged, rejects all other `data:` schemes (e.g. `data:text/html`), and runs `normalizeUrl` on everything else (which blocks `javascript:` / `vbscript:` and prepends `https://` to bare domains).

### extensions useMemo deps

`WysiwygEditor` keeps `readOnly` and `placeholder` **out of the `extensions` useMemo deps**. Changing them must not rebuild the editor (which would destroy undo history and lose the selection). Instead:
- `readOnly` changes are applied via `editor.setEditable(!readOnly)` in a `useEffect`. `Link.configure({ openOnClick: false })` is a constant — TipTap's built-in `view.editable` check already prevents link-click navigation in read-only mode.
- `placeholder` changes are reflected live via `Placeholder.configure({ placeholder: () => placeholderRef.current })` — the function closure always reads the current ref value, so the decoration is updated on the next view update without rebuilding the editor.

Only `minimal` is in the deps (because it changes the structural extension array by adding/removing the slash menu).

### Focus discipline rule

**Every closing path must refocus the editor.** When any popup, dropdown, or menu closes, focus must return to the TipTap editor so the user can continue typing without clicking.

Implementation pattern (Radix DropdownMenuContent):
```tsx
<DropdownMenuContent
  onCloseAutoFocus={(e) => { e.preventDefault(); editor.commands.focus() }}
>
```

Implemented on:
- `TableControls.tsx` row and column DropdownMenuContent (Phase 3)
- `Toolbar.tsx` ListButtonEntry DropdownMenuContent (Phase 4)
- `SelectionBubble.tsx` HeadingDropdown DropdownMenuContent (Phase 4)
- `WidgetPopover.tsx` close/save/cancel all call `editor.commands.closeWidgetForm()` which internally calls `editor.commands.focus()` (Phase 2)
