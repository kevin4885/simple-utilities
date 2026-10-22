import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { JsonView } from './JsonView'
import { base64ByteLength, base64ToBytes, cleanBase64, copyText, downloadBlob } from './viewerIo'

/**
 * Safe renderer for MCP content blocks (`content[]`, prompt message content) and `resources/read`
 * `contents[]`. Everything from the server is untrusted and is rendered as TEXT only:
 *  - no HTML/markdown interpretation;
 *  - raster images (png/jpeg/gif/webp) and audio only via `data:` URLs;
 *  - URIs are shown as text and never turned into links or fetched.
 */
export type ContentViewProps = { blocks: unknown[] } | { resourceContents: unknown[] }

const RASTER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const AUDIO_TYPE_RE = /^audio\/[a-z0-9][a-z0-9.+-]*$/
const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/

type Rec = Record<string, unknown>

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function safeFilename(uri: string | null): string {
  const last = (uri ?? '').split(/[/\\?#]/).filter(Boolean).pop() ?? ''
  const cleaned = last.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
  return cleaned || 'resource.bin'
}

function Meta({ children }: { children: React.ReactNode }) {
  return <div className="text-xs break-all text-muted-foreground">{children}</div>
}

function BinaryNotice({ label, mime, size }: { label: string; mime: string; size: number | null }) {
  return (
    <div className="rounded-md border border-dashed p-2 text-sm">
      <div className="font-medium">{label}</div>
      <Meta>
        {mime || 'unknown mime type'}
        {size !== null ? ` · ${formatBytes(size)}` : ''}
      </Meta>
    </div>
  )
}

function ImageBlock({ data, mimeType }: { data: unknown; mimeType: unknown }) {
  const mime = (str(mimeType) ?? '').trim().toLowerCase()
  const clean = typeof data === 'string' ? cleanBase64(data) : null
  const size = clean === null ? null : base64ByteLength(clean)
  if (!RASTER_IMAGE_TYPES.has(mime) || clean === null) {
    return (
      <BinaryNotice
        label={RASTER_IMAGE_TYPES.has(mime) ? 'Invalid image data' : 'Unsupported image type'}
        mime={mime}
        size={size}
      />
    )
  }
  return (
    <img
      src={`data:${mime};base64,${clean}`}
      alt="Image content from server"
      className="max-h-96 max-w-full rounded-md border object-contain"
    />
  )
}

function AudioBlock({ data, mimeType }: { data: unknown; mimeType: unknown }) {
  const mime = (str(mimeType) ?? '').trim().toLowerCase()
  const clean = typeof data === 'string' ? cleanBase64(data) : null
  const size = clean === null ? null : base64ByteLength(clean)
  if (!AUDIO_TYPE_RE.test(mime) || clean === null) {
    return <BinaryNotice label="Unsupported audio data" mime={mime} size={size} />
  }
  return (
    <div className="space-y-1">
      <audio controls src={`data:${mime};base64,${clean}`} className="w-full" />
      <Meta>
        {mime} · {formatBytes(size ?? 0)}
      </Meta>
    </div>
  )
}

function BlobEntry({ uri, mimeType, blob }: { uri: string | null; mimeType: string | null; blob: string }) {
  const clean = cleanBase64(blob)
  if (clean === null) return <BinaryNotice label="Invalid binary data" mime={mimeType ?? ''} size={null} />
  const size = base64ByteLength(clean)
  const mime = mimeType?.trim().toLowerCase() ?? ''
  const downloadType = MIME_RE.test(mime) ? mime : 'application/octet-stream'
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 text-sm">
      <span className="font-medium">Binary content</span>
      <Meta>{formatBytes(size)}</Meta>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => downloadBlob(safeFilename(uri), base64ToBytes(clean), downloadType)}
      >
        Download
      </Button>
    </div>
  )
}

/** One `resources/read` content entry, or the `resource` of an embedded-resource block. */
function ResourceEntry({ entry }: { entry: unknown }) {
  if (!isRec(entry)) return <JsonView value={entry} />
  const uri = str(entry.uri)
  const mimeType = str(entry.mimeType)
  const text = str(entry.text)
  const blob = str(entry.blob)
  if (text === null && blob === null) return <JsonView value={entry} />
  return (
    <div className="space-y-1" data-slot="content-resource">
      <Meta>
        {uri ?? 'no uri'}
        {mimeType ? ` · ${mimeType}` : ''}
      </Meta>
      {text !== null ? <JsonView value={text} /> : <BlobEntry uri={uri} mimeType={mimeType} blob={blob ?? ''} />}
    </div>
  )
}

function ResourceLinkBlock({ block }: { block: Rec }) {
  const uri = str(block.uri)
  const name = str(block.name)
  const title = str(block.title)
  const description = str(block.description)
  const mimeType = str(block.mimeType)
  return (
    <div className="space-y-1 rounded-md border p-2 text-sm" data-slot="content-resource-link">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">resource link</Badge>
        {(title ?? name) && <span className="font-medium break-words">{title ?? name}</span>}
      </div>
      <div className="font-mono text-xs break-all">{uri ?? '(no uri)'}</div>
      {title && name && <Meta>{name}</Meta>}
      {description && <div className="break-words whitespace-pre-wrap text-muted-foreground">{description}</div>}
      {mimeType && <Meta>{mimeType}</Meta>}
      {uri && (
        <Button type="button" variant="outline" size="xs" onClick={() => void copyText(uri)}>
          Copy URI
        </Button>
      )}
    </div>
  )
}

function Block({ block }: { block: unknown }) {
  if (!isRec(block)) return <JsonView value={block} />
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? <JsonView value={block.text} /> : <JsonView value={block} />
    case 'image':
      return <ImageBlock data={block.data} mimeType={block.mimeType} />
    case 'audio':
      return <AudioBlock data={block.data} mimeType={block.mimeType} />
    case 'resource_link':
      return <ResourceLinkBlock block={block} />
    case 'resource':
      return <ResourceEntry entry={block.resource} />
    default:
      return <JsonView value={block} />
  }
}

export function ContentView(props: ContentViewProps) {
  const isContents = 'resourceContents' in props
  const items = isContents ? props.resourceContents : props.blocks
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="text-sm text-muted-foreground">No content.</div>
  }
  return (
    <div className="space-y-2" data-slot="content-view">
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          {isContents ? <ResourceEntry entry={item} /> : <Block block={item} />}
        </div>
      ))}
    </div>
  )
}
