import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-4xl font-bold text-muted-foreground">404</h1>
      <p className="text-lg text-muted-foreground">Page not found</p>
      <Link
        to="/"
        className="inline-flex items-center justify-center rounded-md border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        Go home
      </Link>
    </div>
  )
}
