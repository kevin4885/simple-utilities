/**
 * importSweep.io — thin, side-effecting I/O wrapper around the pure
 * `decideImport` logic in `./importSweep.ts`.
 *
 * Tools register themselves via `registerSweepTarget` — each target
 * supplies its `toolId`, a synchronous reader for its current local items
 * (one item per row it would write in the cloud; single-blob tools return
 * exactly one item with `itemId: 'default'`), and its own Zod schema. No
 * tool registers itself in this phase (no `src/tools/**` file is touched
 * here) — the registry starts empty and Phase 2/3 populate it as each
 * tool's `store.ts` migrates to `useToolState`. `runImportSweep` iterating
 * an empty registry is a valid, no-op sweep.
 *
 * Existence-check-based, not flag-based: for every registered tool, every
 * local item is checked against the cloud rows that already exist for
 * that tool before deciding to import — never overwrites an existing row,
 * regardless of its content. A failure importing one tool/item is caught
 * and logged so it never blocks any other tool's sweep.
 */
import type { z } from 'zod'
import { supabase } from '../supabase/client'
import { decideImport } from './importSweep'

export interface SweepItem {
  /** 'default' for single-blob tools; a doc/note id for multi-item tools. */
  itemId: string
  /** Current local (already-parsed, not-yet-validated) value for this item. */
  data: unknown
}

export interface SweepTarget {
  toolId: string
  /** Reads this tool's current local items synchronously. Empty array if
   *  nothing is stored locally for this tool. */
  getLocalItems: () => SweepItem[]
  /** The tool's own Zod schema — each item's local data is validated
   *  through this before being considered importable. */
  schema: z.ZodType<unknown>
}

/** Populated by each migrated tool's `store.ts` (Phase 2+) via
 *  `registerSweepTarget`; empty in this phase. */
const sweepTargets: SweepTarget[] = []

export function registerSweepTarget(target: SweepTarget): void {
  sweepTargets.push(target)
}

/**
 * Runs the import sweep for `userId` across every target in `targets`
 * (defaults to the module's registered targets — pass an explicit array in
 * tests to avoid depending on registration order/state). Safe to call
 * repeatedly: a target with no cloud rows for a given item id imports it
 * once; on every subsequent call (e.g. a later sign-in on the same or a
 * different device) that item now has a cloud row, so it is skipped.
 */
export async function runImportSweep(
  userId: string,
  targets: SweepTarget[] = sweepTargets,
): Promise<void> {
  for (const target of targets) {
    try {
      await sweepTarget(userId, target)
    } catch (err) {
      console.error(`[importSweep] failed for tool "${target.toolId}":`, err)
    }
  }
}

async function sweepTarget(userId: string, target: SweepTarget): Promise<void> {
  const localItems = target.getLocalItems()
  if (localItems.length === 0) return

  const { data: existingRows, error } = await supabase
    .from('tool_state')
    .select('item_id')
    .eq('user_id', userId)
    .eq('tool_id', target.toolId)

  if (error) {
    console.error(`[importSweep] failed to read existing rows for "${target.toolId}":`, error)
    return
  }

  const existingIds = new Set((existingRows ?? []).map((row) => row.item_id as string))

  for (const item of localItems) {
    const decision = decideImport(
      existingIds.has(item.itemId) ? [item.itemId] : [],
      item.data,
      target.schema,
    )
    if (decision.action !== 'import') continue

    const { error: upsertError } = await supabase.from('tool_state').upsert({
      user_id: userId,
      tool_id: target.toolId,
      item_id: item.itemId,
      data: decision.payload,
    })
    if (upsertError) {
      console.error(
        `[importSweep] failed to import "${target.toolId}/${item.itemId}":`,
        upsertError,
      )
    }
  }
}
