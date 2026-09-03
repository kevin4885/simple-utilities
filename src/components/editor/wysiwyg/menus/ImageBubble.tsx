/**
 * wysiwyg/menus/ImageBubble.tsx
 *
 * Image bubble toolbar — appears below the selected image node.
 * Shows Edit and Remove buttons.
 */

import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ImageBubbleProps {
  editor: Editor
  onEdit: () => void
}

export function ImageBubble({ editor, onEdit }: ImageBubbleProps) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="imageBubble"
      options={{ placement: 'bottom' }}
      shouldShow={({ editor: e }) => e.isActive('image')}
    >
      <div className="wysiwyg-bubble-toolbar">
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          title="Edit image"
          aria-label="Edit image"
          onClick={onEdit}
        >
          <PencilIcon className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          title="Remove image"
          aria-label="Remove image"
          onClick={() => {
            editor.chain().focus().deleteSelection().run()
          }}
        >
          <Trash2Icon className="h-3 w-3" />
        </Button>
      </div>
    </BubbleMenu>
  )
}
