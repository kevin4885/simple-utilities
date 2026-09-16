import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { App } from './app/App'
import { AuthProvider } from './lib/auth/useAuth'

// Auto-update service worker: new versions activate on next load
registerSW({ immediate: true })

// One QueryClient for the whole app — mounted above the router so both
// LandingPage and every route under AppShell share it. Cleared on sign-out
// (see useAuth's signOut) so a second Google account on the same browser
// never sees a flash of the previous account's cached tool data.
const queryClient = new QueryClient()

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
