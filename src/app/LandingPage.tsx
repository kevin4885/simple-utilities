import { Link } from 'react-router'
import { Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LANDING_COPY } from '@/lib/content'
import { useDocumentMeta } from '@/lib/useDocumentMeta'

/**
 * LandingPage — the marketing root at `/`. Deliberately has no relation to
 * `AppShell`: no sticky Header, no Ctrl+K command palette, normal document
 * scrolling (no viewport scroll-lock). Its own minimal header/footer link
 * into the interactive tool browser at `/app`.
 */
export function LandingPage() {
  useDocumentMeta(LANDING_COPY.title, LANDING_COPY.description)

  return (
    <div className="min-h-dvh flex flex-col bg-background text-foreground">
      {/* ── Minimal header ── */}
      <header className="border-b">
        <div className="mx-auto max-w-5xl flex items-center gap-4 px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-bold text-foreground">
            <Wrench className="h-5 w-5 text-primary" />
            <span>Simple Utilities</span>
          </Link>
          <div className="flex-1" />
          <Button asChild>
            <Link to="/app">Browse tools</Link>
          </Button>
        </div>
      </header>

      {/* ── Hero ── */}
      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-6 py-16 text-center space-y-6">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{LANDING_COPY.headline}</h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">{LANDING_COPY.subhead}</p>
          <div>
            <Button asChild size="lg">
              <Link to="/app">Browse all tools</Link>
            </Button>
          </div>
        </section>

        {/* ── Highlights ── */}
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LANDING_COPY.highlights.map((h) => (
              <Card key={h.title}>
                <CardHeader>
                  <CardTitle className="text-base">{h.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{h.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      {/* ── Minimal footer ── */}
      <footer className="border-t">
        <div className="mx-auto max-w-5xl px-6 py-8 text-center text-sm text-muted-foreground">
          <Link to="/app" className="underline hover:text-foreground">
            Browse all tools
          </Link>
        </div>
      </footer>
    </div>
  )
}
