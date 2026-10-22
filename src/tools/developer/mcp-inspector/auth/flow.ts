import type { McpSession } from '../connection/session'

// Placeholder slot created by the shell phase; the OAuth phase replaces this file.
export const completeAuthorization: (session: McpSession, profileId: string, signal: AbortSignal) => Promise<void> = () =>
  Promise.reject(new Error('OAuth sign-in is not implemented yet.'))

export const consumePendingOAuthReturn: () => { profileId: string; code: string; state: string } | null = () => null
