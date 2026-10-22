import type { ComponentType } from 'react'
import type { Profile } from '../schemas'

// Placeholder slot created by the shell phase; the OAuth phase replaces this file.
const AuthPanel: ComponentType<{
  profile: Profile
  onChange(patch: Partial<Pick<Profile, 'auth'>>): void
  disabled?: boolean
}> = () => <p className="text-xs text-muted-foreground">Not implemented yet</p>

export default AuthPanel
