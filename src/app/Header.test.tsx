/**
 * Header — sign-in/sign-out UI, mocked `useAuth()` in both states. `theme.ts`
 * calls `window.matchMedia` at module-load time (see App.test.tsx for the
 * same issue) — stubbed here before any import that transitively pulls in
 * `theme.ts`.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const useAuthMock = vi.fn()
vi.mock('@/lib/auth/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

let Header: typeof import('./Header').Header

beforeAll(async () => {
  ;({ Header } = await import('./Header'))
})

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header onSearchClick={() => {}} />
    </MemoryRouter>,
  )
}

describe('Header — auth UI', () => {
  it('renders a "Sign in with Google" control when signed out', () => {
    useAuthMock.mockReturnValue({
      user: null,
      status: 'signed-out',
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
    })

    renderHeader()

    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Account menu')).not.toBeInTheDocument()
  })

  it('renders a signed-in indicator + sign-out control when signed in', () => {
    useAuthMock.mockReturnValue({
      user: {
        id: 'user-1',
        email: 'jane@example.com',
        user_metadata: { full_name: 'Jane Doe' },
      },
      status: 'signed-in',
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
    })

    renderHeader()

    expect(screen.getByLabelText('Account menu')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
  })
})

describe('LandingPage — no auth UI', () => {
  it('renders neither the sign-in control nor the account menu, in either auth state', async () => {
    const { LandingPage } = await import('./LandingPage')

    useAuthMock.mockReturnValue({
      user: null,
      status: 'signed-out',
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
    })
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Account menu')).not.toBeInTheDocument()
  })
})
