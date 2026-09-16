/**
 * Supabase client — one shared instance for the whole app.
 *
 * Reads its config from build-time env vars (`VITE_SUPABASE_URL`,
 * `VITE_SUPABASE_ANON_KEY` — see `.env.example`). Both are safe to expose
 * client-side: the anon key relies on Postgres Row Level Security for
 * safety, not secrecy (see `supabase/migrations/0001_tool_state.sql` and
 * root `CLAUDE.md`'s Constraints section).
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — ' +
      'see .env.example. Auth and cloud state will not work until these are configured.',
  )
}

// `createClient` throws synchronously if the URL is empty/invalid, which would
// crash the whole app at module-load time in any environment without `.env`
// configured (e.g. this repo's test/build environment). Fall back to a
// syntactically-valid placeholder so the client always constructs; every
// actual network call will simply fail (and be logged) until real
// credentials are configured, matching how a misconfigured deploy fails today.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.invalid',
  supabaseAnonKey || 'placeholder-anon-key',
)
