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
    <div>
      <div className="border-b bg-muted/30">
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
  )
}
