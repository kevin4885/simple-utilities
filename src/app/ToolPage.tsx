import { Suspense } from 'react'
import { useParams, Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { getToolById } from '@/tools/registry'
import { NotFoundPage } from './NotFoundPage'

export function ToolPage() {
  const { id } = useParams<{ id: string }>()
  const tool = id ? getToolById(id) : undefined

  if (!tool) return <NotFoundPage />

  const ToolComponent = tool.component

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb bar */}
      <div className="border-b bg-muted/30 shrink-0">
        <div className="px-6 py-3">
          <Link
            to="/"
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
