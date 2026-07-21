import { Link, useSearchParams } from 'react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { tools, categories } from '@/tools/registry'

export function HomePage() {
  const [searchParams] = useSearchParams()
  const activeCategory = searchParams.get('category')

  const displayCategories = activeCategory
    ? categories.filter((c) => c === activeCategory)
    : categories

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-10">
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
    </div>
  )
}
