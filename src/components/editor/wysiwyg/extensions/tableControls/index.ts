/**
 * tableControls/index.ts
 *
 * TipTap Extension that registers the tableControls ProseMirror plugin.
 * Import `tableControlsExtension` and add it to the editor's extensions array.
 */

import { Extension } from '@tiptap/core'
import { createTableControlsPlugin } from './plugin'

export { tableControlsKey, setDropdownOpen } from './plugin'
export type { TableControlsState } from './plugin'
export * from './commands'

export const tableControlsExtension = Extension.create({
  name: 'tableControls',

  addProseMirrorPlugins() {
    return [createTableControlsPlugin()]
  },
})
