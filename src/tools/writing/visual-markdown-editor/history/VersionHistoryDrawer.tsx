/**
 * VersionHistoryDrawer — thin Sheet wrapper around VersionHistoryPanel.
 */

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import VersionHistoryPanel, { type VersionHistoryPanelProps } from './VersionHistoryPanel'

export type VersionHistoryDrawerProps = Omit<VersionHistoryPanelProps, 'onClose'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function VersionHistoryDrawer({ open, onOpenChange, ...rest }: VersionHistoryDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="w-full sm:w-[28rem] sm:max-w-md p-0 flex flex-col gap-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Version History</SheetTitle>
        </SheetHeader>
        <VersionHistoryPanel {...rest} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  )
}
