import Fuse from 'fuse.js'
import { tools, type ToolDef } from '@/tools/registry'

// ---------------------------------------------------------------------------
// Fuse.js index
// ---------------------------------------------------------------------------
//
// Key weights:
//   title       0.50 — primary signal; users type what they think the tool is called
//   keywords    0.35 — important tags like 'jwt', 'prettify', 'escape'
//   description 0.15 — long-form context; useful for phrase matches
//
// Typo-tolerance settings (empirically validated):
//   ignoreLocation:true  — fuzzy matches across the whole string, not just near pos 0
//   threshold:0.5        — allows transpositions like 'josn'→'json' and
//                          deletions like 'fromatter'→'formatter' (score ~0.35)
//   minMatchCharLength:3 — prevents single/double-char noise from matching everything

const fuse = new Fuse(tools, {
  keys: [
    { name: 'title', weight: 0.5 },
    { name: 'keywords', weight: 0.35 },
    { name: 'description', weight: 0.15 },
  ],
  ignoreLocation: true,
  threshold: 0.5,
  includeScore: true,
  minMatchCharLength: 3,
})

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search across all tools using Fuse.js fuzzy matching.
 *
 * - Empty / whitespace query → returns all tools in registry order.
 * - Non-empty query          → returns Fuse-ranked results (best match first).
 */
export function searchTools(query: string): ToolDef[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return tools
  }
  return fuse.search(trimmed).map((r) => r.item)
}
