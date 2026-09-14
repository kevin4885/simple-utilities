import { Suspense } from 'react'
import { useParams, Link, Navigate } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { getToolById, LEGACY_TOOL_IDS } from '@/tools/registry'
import { NotFoundPage } from './NotFoundPage'
import { useDocumentMeta } from '@/lib/useDocumentMeta'
import { truncateDescription } from '@/lib/content'

export function ToolPage() {
  const { id } = useParams<{ id: string }>()
  const tool = id ? getToolById(id) : undefined

  // useDocumentMeta must be called unconditionally at the top level (React's
  // rules of hooks — and this repo's `eslint-plugin-react-hooks` lint rule —
  // forbid a hook call sitting after a conditional `return`, since `tool`
  // can flip between resolved/unresolved across renders of the same mounted
  // instance as `:id` changes). When `tool` isn't resolved (legacy-id
  // redirect, about to navigate away; or a genuine 404 for this id) we pass
  // the app's base title/description rather than blanking the tab — the
  // legacy-redirect case unmounts immediately, and the 404 case still gets a
  // sensible fallback instead of an empty title.
  useDocumentMeta(
    tool ? `${tool.title} — Simple Utilities` : 'Simple Utilities',
    tool ? truncateDescription(tool.description, 155) : '',
  )

  if (!tool && id && LEGACY_TOOL_IDS[id]) {
    return <Navigate to={`/tools/${LEGACY_TOOL_IDS[id]}`} replace />
  }

  if (!tool) return <NotFoundPage />

  const ToolComponent = tool.component

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb bar */}
      <div className="border-b bg-muted/30 shrink-0">
        <div className="px-6 py-3">
          <Link
            to="/app"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            All tools
          </Link>
          <span className="mx-2 text-muted-foreground/40">·</span>
          <span className="text-sm text-muted-foreground">{tool.category}</span>
        </div>
      </div>
      {/* Tool content — scrollable for normal tools, fills height for full-bleed tools */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              Loading…
            </div>
          }
        >
          <ToolComponent />
        </Suspense>
      </div>
    </div>
  )
}
