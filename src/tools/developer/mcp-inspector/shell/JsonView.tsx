import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { copyText } from './viewerIo'

/** Longest text (chars) rendered inline; longer values show a preview plus a "Copy full" button. */
export const JSON_VIEW_MAX_CHARS = 200_000

/** Text shown for a value: `undefined` -> em dash, strings as-is, everything else pretty JSON (2 spaces). */
export function valueToText(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  try {
    const json = JSON.stringify(value, null, 2)
    return json === undefined ? String(value) : json
  } catch {
    // circular structures, BigInt, throwing toJSON
    return String(value)
  }
}

/**
 * Read-only, text-only renderer for any value. Server content is untrusted: it is only ever
 * placed in a text node, never interpreted as HTML.
 */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const full = useMemo(() => valueToText(value), [value])
  const truncated = full.length > JSON_VIEW_MAX_CHARS
  const shown = truncated ? full.slice(0, JSON_VIEW_MAX_CHARS) : full
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  return (
    <div className={cn('min-w-0', className)} data-slot="json-view">
      <pre className="max-h-96 overflow-auto rounded-md bg-muted p-2 font-mono text-xs break-words whitespace-pre-wrap text-foreground">
        {shown}
      </pre>
      {truncated && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status">
          <span>
            Output truncated: showing the first {JSON_VIEW_MAX_CHARS.toLocaleString('en-US')} of{' '}
            {full.length.toLocaleString('en-US')} characters.
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={async () => setCopyState((await copyText(full)) ? 'copied' : 'failed')}
          >
            Copy full
          </Button>
          {copyState === 'copied' && <span>Copied</span>}
          {copyState === 'failed' && <span className="text-destructive">Copy failed</span>}
        </div>
      )}
    </div>
  )
}
