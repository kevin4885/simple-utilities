import { Link, useSearchParams } from 'react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { tools, categories } from '@/tools/registry'

function pillClass(isActive: boolean) {
  return isActive
    ? 'rounded-full px-3 py-1 text-sm font-medium bg-primary text-primary-foreground transition-colors w-full text-left'
    : 'rounded-full px-3 py-1 text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors w-full text-left'
}

export function HomePage() {
  const [searchParams] = useSearchParams()
  const activeCategory = searchParams.get('category')

  const displayCategories = activeCategory
    ? categories.filter((c) => c === activeCategory)
    : categories

  return (
    <div className="flex min-h-[calc(100vh-57px)]">

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex flex-col gap-1 w-52 shrink-0 border-r px-4 py-6 sticky top-[57px] h-[calc(100vh-57px)] overflow-y-auto">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-3">
          Categories
        </p>
        <Link to="/" className={pillClass(activeCategory === null)}>
          All
        </Link>
        <div className="my-2 border-t" />
        {categories.map((cat) => (
          <Link
            key={cat}
            to={`/?category=${encodeURIComponent(cat)}`}
            className={pillClass(activeCategory === cat)}
          >
            {cat}
          </Link>
        ))}
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 px-6 py-8 space-y-10 min-w-0">
        <div>
          <h1 className="text-3xl font-bold">Simple Utilities</h1>
          <p className="mt-2 text-muted-foreground">
            A collection of small, useful tools. Pick a category or browse them all.
          </p>
        </div>

        {displayCategories.length === 0 && (
          <div className="rounded-lg border bg-muted/30 px-6 py-12 text-center text-muted-foreground">
            No tools found in this category.{' '}
            <Link to="/" className="text-primary underline">
              Browse all
            </Link>
          </div>
        )}

        {displayCategories.map((category) => {
          const categoryTools = tools.filter((t) => t.category === category)
          return (
            <section key={category}>
              <h2 className="mb-4 text-xl font-semibold border-b pb-2">{category}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {categoryTools.map((tool) => (
                  <Link key={tool.id} to={`/tools/${tool.id}`} className="group">
                    <Card className="h-full transition-all group-hover:border-primary/50 group-hover:shadow-md">
                      <CardHeader>
                        <CardTitle className="text-base group-hover:text-primary transition-colors">
                          {tool.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <CardDescription className="line-clamp-2">{tool.description}</CardDescription>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )
        })}
      </main>
    </div>
  )
}
