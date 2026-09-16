/**
 * useToolItemList — lists all `item_id`s a tool has stored for the current
 * user. Needed by multi-item tools (e.g. markdown-editor, migrated in
 * Phase 2) to enumerate their documents when signed in.
 *
 * Signed in: queries `tool_state` scoped to the current session's user id
 * and the caller's `toolId` — never a caller-supplied `user_id` — and
 * returns the distinct `item_id` values found.
 *
 * Signed out: there is no single generic "local item list" — each
 * multi-item tool has its own local shape today (e.g. markdown-editor's
 * `docs[]` array), so this hook simply returns an empty list while signed
 * out. Wiring a signed-out tool's own local item ids into its UI remains
 * that tool's own concern (Phase 2 for markdown-editor), not something this
 * generic hook can know about.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase/client'
import { useAuth } from '../auth/useAuth'

export interface UseToolItemListResult {
  itemIds: string[]
  isLoading: boolean
}

export function toolItemListQueryKey(userId: string | undefined, toolId: string) {
  return ['tool_state_item_list', userId, toolId] as const
}

export function useToolItemList(toolId: string): UseToolItemListResult {
  const { status, user } = useAuth()
  const userId = user?.id
  const signedIn = status === 'signed-in' && !!userId

  const query = useQuery({
    queryKey: toolItemListQueryKey(userId, toolId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tool_state')
        .select('item_id')
        .eq('user_id', userId as string)
        .eq('tool_id', toolId)
      if (error) throw error
      return (data ?? []).map((row) => row.item_id as string)
    },
    enabled: signedIn,
  })

  if (signedIn) {
    return { itemIds: query.data ?? [], isLoading: query.isLoading }
  }

  return { itemIds: [], isLoading: false }
}
