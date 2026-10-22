import type { OAuthClientProvider } from '@modelcontextprotocol/client'
import type { Profile } from '../schemas'

// Placeholder slot created by the shell phase; the OAuth phase replaces this file.
export const buildAuthProvider: (profile: Profile, origin: string) => OAuthClientProvider | undefined = () => undefined
