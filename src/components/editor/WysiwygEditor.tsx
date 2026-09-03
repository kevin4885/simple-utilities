/**
 * src/components/editor/WysiwygEditor.tsx
 *
 * Re-export shim — the implementation has moved to ./wysiwyg/WysiwygEditor.tsx.
 * This file keeps all existing imports (e.g. @/components/editor/WysiwygEditor)
 * and the adjacent test file working without change.
 */

export { default } from './wysiwyg/WysiwygEditor'
export type { WysiwygEditorHandle, WysiwygEditorProps } from './wysiwyg/WysiwygEditor'

// Named exports that tests / other files import from the old location
export { MARKDOWN_LINK_REGEX } from './wysiwyg/extensions/linkKeyboard'
export { normalizeUrl } from './wysiwyg/utils'
