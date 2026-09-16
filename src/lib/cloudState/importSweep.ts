/**
 * importSweep — pure decision logic for the first-sign-in local→cloud
 * import sweep.
 *
 * Existence-check-based, not flag-based: given the set of item ids that
 * already exist in the cloud for a given tool/item scope, decide whether to
 * import the tool's current local data or skip. Never overwrites an
 * existing cloud row, under any condition — if any relevant cloud row
 * already exists, always "skip," regardless of what that row contains.
 *
 * Pure and side-effect-free so it is directly unit-testable without a
 * network or a mocked Supabase client — mirrors the existing
 * `mergePersisted` validation pattern (untrusted JSON in, validated typed
 * data out, never trust raw JSON silently). The actual Supabase network
 * calls that use this decision live in the thin I/O wrapper,
 * `./importSweep.io.ts`.
 */
import type { z } from 'zod'

export type ImportDecision<T> = { action: 'skip' } | { action: 'import'; payload: T }

/**
 * @param existingCloudItemIds - the item id(s) that already exist in the
 *   cloud for the scope being checked (e.g. `[]` if no row exists yet for
 *   this tool/item, or `[itemId]` if one does). A non-empty list always
 *   means "skip" — the specific ids/content are irrelevant to the decision.
 * @param localData - the tool's current localStorage-persisted value,
 *   already JSON-parsed (or `undefined`/`null` if nothing is stored).
 * @param schema - the tool's own Zod schema; `localData` is validated
 *   through it before being considered importable.
 */
export function decideImport<T>(
  existingCloudItemIds: string[],
  localData: unknown,
  schema: z.ZodType<T>,
): ImportDecision<T> {
  if (existingCloudItemIds.length > 0) return { action: 'skip' }
  if (localData === null || localData === undefined) return { action: 'skip' }

  const result = schema.safeParse(localData)
  if (!result.success) return { action: 'skip' }

  return { action: 'import', payload: result.data }
}
