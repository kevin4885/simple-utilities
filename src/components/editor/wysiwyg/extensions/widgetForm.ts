/**
 * wysiwyg/extensions/widgetForm.ts
 *
 * Generic in-document widget-anchor extension.
 *
 * Design (mirrors gravity-ui ImageWidget):
 * ─────────────────────────────────────────
 * A ProseMirror Plugin holds a DecorationSet.  When a form is "opened" an
 * anchor decoration is inserted according to the requested anchor `mode`:
 *
 *   chip  — Decoration.widget() at selection.from. A small inline chip
 *            (<span class="wysiwyg-widget-anchor">) appears in the document.
 *            Radix PopoverAnchor / floating-ui tracks the element.
 *            Used for link/image/table when selection is empty and not inside
 *            an existing link or image.
 *
 *   range — Decoration.inline(from, to, { class: 'wysiwyg-link-target' }).
 *            No chip; the selected text itself is highlighted.
 *            from/to are either the non-empty selection, or the full extent of
 *            the existing link mark under the cursor.
 *            The anchor DOM is resolved lazily in the plugin view's update()
 *            after ProseMirror renders the decoration, by querying
 *            view.dom.querySelector('.wysiwyg-link-target').
 *
 *   node  — No decoration at all. dom = view.nodeDOM(selection.from) (the
 *            <img> element). Used when editor.isActive('image').
 *
 * On save/cancel the decoration is removed and the editor is refocused.
 *
 * Plugin state: { decorations: DecorationSet, active: ActiveWidget | null }
 *
 * Meta actions dispatched via tr.setMeta(widgetFormKey, action):
 *   { type: 'open', kind, id, mode, dom?, rangeFrom?, rangeTo?, nodePos? }
 *   { type: 'close', id }
 *
 * The extension exposes `editor.storage.widgetForm`:
 *   active: ActiveWidget | null
 *   subscribe(cb) / unsubscribe(cb)
 *
 * TipTap commands:
 *   openWidgetForm(kind, opts)  — creates anchor, dispatches 'open' meta
 *   closeWidgetForm()           — dispatches 'close' meta, refocuses editor
 */

import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WidgetFormKind = 'link' | 'image' | 'table'

/**
 * Anchor mode determines what decoration (if any) is created when a form opens.
 *   chip  — widget decoration + chip DOM at selection.from
 *   range — inline decoration spanning the link text; dom resolved lazily
 *   node  — no decoration; dom = the image node element
 */
export type AnchorMode = 'chip' | 'range' | 'node'

export interface ActiveWidget {
  id: string
  kind: WidgetFormKind
  mode: AnchorMode
  /**
   * The anchor DOM element used as the Radix virtualRef.
   * - chip:  the chip <span> (immediately available)
   * - range: lazily resolved — the first .wysiwyg-link-target span in view.dom
   * - node:  the image DOM element (view.nodeDOM(nodePos))
   * Will be null for range mode until the decoration has been rendered.
   */
  dom: HTMLElement | null
  /**
   * The selection range that was active when the widget was opened.
   * selectionFrom === selectionTo for empty-cursor opens.
   */
  selectionFrom: number
  selectionTo: number
  /**
   * range mode: the from/to of the decoration span (may differ from selection
   * when we expand to cover an existing link mark).
   * chip/node mode: same as selectionFrom/selectionTo.
   */
  rangeFrom: number
  rangeTo: number
  /**
   * node mode only: the document position of the image node.
   */
  nodePos?: number
  /** Lazily resolved: chip mode only — finds decoration position */
  getPos: () => number | null
}

interface PluginStateShape {
  decorations: DecorationSet
  active: {
    id: string
    kind: WidgetFormKind
    mode: AnchorMode
    dom: HTMLElement | null
    selectionFrom: number
    selectionTo: number
    rangeFrom: number
    rangeTo: number
    nodePos?: number
  } | null
}

export interface WidgetFormStorage {
  active: ActiveWidget | null
  _listeners: Set<(active: ActiveWidget | null) => void>
  subscribe: (cb: (active: ActiveWidget | null) => void) => void
  unsubscribe: (cb: (active: ActiveWidget | null) => void) => void
  _notify: (active: ActiveWidget | null) => void
}

// ---------------------------------------------------------------------------
// Plugin key — public so React side can dispatch metas
// ---------------------------------------------------------------------------

export const widgetFormKey = new PluginKey<PluginStateShape>('widgetForm')

// ---------------------------------------------------------------------------
// Chip DOM builder — creates the inline anchor element (chip mode only)
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<WidgetFormKind, string> = {
  link: 'Link',
  image: 'Image',
  table: 'Table',
}

function buildChipIcon(kind: WidgetFormKind): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')

  const iconPaths: Record<WidgetFormKind, string[]> = {
    link: [
      'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
      'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    ],
    image: [
      'rect width="18" height="18" x="3" y="3" rx="2" ry="2"',
      'M3 9h18',
      'M9 21V9',
    ],
    table: [
      'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18',
    ],
  }

  for (const d of iconPaths[kind]) {
    if (d.startsWith('rect ')) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      const attrs = d.slice(5).split(' ')
      for (const attr of attrs) {
        const [k, v] = attr.split('=')
        if (k && v) rect.setAttribute(k, v.replace(/"/g, ''))
      }
      svg.appendChild(rect)
    } else {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', d)
      svg.appendChild(path)
    }
  }
  return svg
}

export function buildWidgetAnchorDom(kind: WidgetFormKind): HTMLElement {
  const span = document.createElement('span')
  span.className = 'wysiwyg-widget-anchor'
  span.setAttribute('data-kind', kind)
  span.setAttribute('data-widget-anchor', 'true')
  span.contentEditable = 'false'

  const icon = buildChipIcon(kind)
  span.appendChild(icon)

  const label = document.createElement('span')
  label.textContent = KIND_LABELS[kind]
  span.appendChild(label)

  return span
}

// ---------------------------------------------------------------------------
// ProseMirror plugin
// ---------------------------------------------------------------------------

function createPlugin(
  onStateChange: (pluginState: PluginStateShape, view: EditorView) => void,
): Plugin<PluginStateShape> {
  return new Plugin<PluginStateShape>({
    key: widgetFormKey,

    state: {
      init(): PluginStateShape {
        return { decorations: DecorationSet.empty, active: null }
      },

      apply(
        tr: Transaction,
        prev: PluginStateShape,
        _oldState: EditorState,
        newState: EditorState,
      ): PluginStateShape {
        const meta = tr.getMeta(widgetFormKey) as
          | {
              type: 'open'
              kind: WidgetFormKind
              id: string
              mode: AnchorMode
              dom?: HTMLElement
              rangeFrom?: number
              rangeTo?: number
              nodePos?: number
            }
          | { type: 'close'; id: string }
          | undefined

        if (meta?.type === 'open') {
          const selFrom = newState.selection.from
          const selTo = newState.selection.to

          if (meta.mode === 'chip') {
            const dom = meta.dom!
            const pos = selFrom
            const deco = Decoration.widget(pos, dom, {
              id: meta.id,
              side: 1,
              key: meta.id,
              stopEvent: () => true,
            })
            return {
              decorations: DecorationSet.create(newState.doc, [deco]),
              active: {
                id: meta.id,
                kind: meta.kind,
                mode: 'chip',
                dom,
                selectionFrom: selFrom,
                selectionTo: selTo,
                rangeFrom: selFrom,
                rangeTo: selTo,
              },
            }
          }

          if (meta.mode === 'range') {
            const from = meta.rangeFrom ?? selFrom
            const to = meta.rangeTo ?? selTo
            const deco = Decoration.inline(
              from,
              to,
              { class: 'wysiwyg-link-target' },
              { id: meta.id },
            )
            return {
              decorations: DecorationSet.create(newState.doc, [deco]),
              active: {
                id: meta.id,
                kind: meta.kind,
                mode: 'range',
                dom: null, // resolved lazily in view.update()
                selectionFrom: selFrom,
                selectionTo: selTo,
                rangeFrom: from,
                rangeTo: to,
              },
            }
          }

          // node mode — no decoration
          return {
            decorations: DecorationSet.empty,
            active: {
              id: meta.id,
              kind: meta.kind,
              mode: 'node',
              dom: null, // resolved lazily in view.update()
              selectionFrom: selFrom,
              selectionTo: selTo,
              rangeFrom: selFrom,
              rangeTo: selTo,
              nodePos: meta.nodePos,
            },
          }
        }

        if (meta?.type === 'close') {
          return { decorations: DecorationSet.empty, active: null }
        }

        // Map decorations through the transaction
        const mappedDecos = prev.decorations.map(tr.mapping, newState.doc)

        // If the decoration was removed by the mapping (e.g. entire block deleted),
        // clear active too
        let active = prev.active
        if (active !== null && active.mode !== 'node') {
          const found = mappedDecos.find(undefined, undefined, (spec) => spec.id === active!.id)
          if (found.length === 0) {
            active = null
          }
        }

        return { decorations: mappedDecos, active }
      },
    },

    props: {
      decorations(state) {
        return widgetFormKey.getState(state)?.decorations ?? DecorationSet.empty
      },

      handleKeyDown(_view, event) {
        if (event.key === 'Escape') {
          const ps = widgetFormKey.getState(_view.state)
          if (ps?.active) {
            _view.dispatch(
              _view.state.tr.setMeta(widgetFormKey, { type: 'close', id: ps.active.id }),
            )
            _view.focus()
            return true
          }
        }
        return false
      },
    },

    view() {
      return {
        update(v: EditorView) {
          const ps = widgetFormKey.getState(v.state)
          if (ps) {
            onStateChange(ps, v)
          }
        },
      }
    },
  })
}

// ---------------------------------------------------------------------------
// TipTap Extension
// ---------------------------------------------------------------------------

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    widgetForm: {
      /** Open a widget for the given kind with the specified anchor mode. */
      openWidgetForm: (
        kind: WidgetFormKind,
        opts?: {
          mode?: AnchorMode
          rangeFrom?: number
          rangeTo?: number
          nodePos?: number
        },
      ) => ReturnType
      /** Close the active widget and refocus the editor. */
      closeWidgetForm: () => ReturnType
    }
  }
}

let _idCounter = 0

export const widgetFormExtension = Extension.create<Record<string, never>, WidgetFormStorage>({
  name: 'widgetForm',

  addStorage() {
    const listeners = new Set<(active: ActiveWidget | null) => void>()
    const storage: WidgetFormStorage = {
      active: null,
      _listeners: listeners,
      subscribe(cb) {
        listeners.add(cb)
      },
      unsubscribe(cb) {
        listeners.delete(cb)
      },
      _notify(active) {
        storage.active = active
        for (const cb of listeners) cb(active)
      },
    }
    return storage
  },

  addProseMirrorPlugins() {
    const storage = this.storage as WidgetFormStorage
    const getEditorView = () => this.editor.view

    const plugin = createPlugin((pluginState, view) => {
      const raw = pluginState.active
      if (!raw) {
        storage._notify(null)
        return
      }

      // Resolve the anchor DOM lazily for range and node modes
      let dom: HTMLElement | null = raw.dom
      if (dom === null) {
        if (raw.mode === 'range') {
          dom = view.dom.querySelector('.wysiwyg-link-target') as HTMLElement | null
        } else if (raw.mode === 'node' && raw.nodePos !== undefined) {
          const nodeDom = view.nodeDOM(raw.nodePos)
          if (nodeDom instanceof HTMLElement) {
            dom = nodeDom
          } else if (nodeDom instanceof Element) {
            dom = nodeDom as HTMLElement
          }
        }
        // If we still can't resolve the DOM, don't notify yet (wait for next update)
        if (dom === null) return
      }

      const activeWidget: ActiveWidget = {
        id: raw.id,
        kind: raw.kind,
        mode: raw.mode,
        dom,
        selectionFrom: raw.selectionFrom,
        selectionTo: raw.selectionTo,
        rangeFrom: raw.rangeFrom,
        rangeTo: raw.rangeTo,
        nodePos: raw.nodePos,
        getPos() {
          if (raw.mode !== 'chip') return null
          const v = getEditorView()
          const ps = widgetFormKey.getState(v.state)
          if (!ps) return null
          const found = ps.decorations.find(undefined, undefined, (spec) => spec.id === raw.id)
          if (found.length === 0) return null
          return found[0].from
        },
      }
      storage._notify(activeWidget)
    })
    return [plugin]
  },

  addCommands() {
    return {
      openWidgetForm:
        (
          kind: WidgetFormKind,
          opts: {
            mode?: AnchorMode
            rangeFrom?: number
            rangeTo?: number
            nodePos?: number
          } = {},
        ) =>
        ({ state, dispatch }) => {
          const id = `wf-${++_idCounter}`
          const mode: AnchorMode = opts.mode ?? 'chip'

          if (dispatch) {
            const meta: {
              type: 'open'
              kind: WidgetFormKind
              id: string
              mode: AnchorMode
              dom?: HTMLElement
              rangeFrom?: number
              rangeTo?: number
              nodePos?: number
            } = { type: 'open', kind, id, mode }

            if (mode === 'chip') {
              meta.dom = buildWidgetAnchorDom(kind)
            } else if (mode === 'range') {
              meta.rangeFrom = opts.rangeFrom
              meta.rangeTo = opts.rangeTo
            } else if (mode === 'node') {
              meta.nodePos = opts.nodePos
            }

            dispatch(state.tr.setMeta(widgetFormKey, meta))
          }
          return true
        },

      closeWidgetForm:
        () =>
        ({
          state,
          dispatch,
          editor,
        }: {
          state: EditorState
          dispatch?: (tr: Transaction) => void
          editor: Editor
        }) => {
          const ps = widgetFormKey.getState(state)
          if (!ps?.active) return false
          if (dispatch) {
            dispatch(state.tr.setMeta(widgetFormKey, { type: 'close', id: ps.active.id }))
          }
          editor.commands.focus()
          return true
        },
    }
  },
})
