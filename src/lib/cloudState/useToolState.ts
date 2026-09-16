/**
 * useToolState — the generic per-tool cloud-state adapter.
 *
 * Signed out: wraps a per-`(toolId, itemId)` Zustand `persist` store, using
 * the exact same localStorage wire format (`{ state: { data }, version }`)
 * and the same `su:<key>` naming convention every existing tool store
 * already uses (single-blob tools use `itemId = 'default'`, giving the key
 * `su:<toolId>` — byte-for-byte the key those tools already persist under,
 * so a future migration to this hook never orphans existing user data).
 * `isLoading` is always `false` here — the localStorage read is synchronous.
 *
 * Signed in: backed by `@tanstack/react-query`. Reads go through
 * `useQuery(['tool_state', userId, toolId, itemId], ...)`, validated via
 * `schema.safeParse` on the raw DB row (falls back to `defaultValue` on a
 * missing row or a validation failure — mirrors the existing
 * `mergePersisted` discipline: never trust raw JSON, never throw). Writes
 * go through a `useMutation` that upserts the row. `user_id` always comes
 * from the current session (`useAuth()`'s `user.id`), never from a
 * caller-supplied value — every query/mutation is scoped to the current
 * user and the caller's own `toolId`/`itemId` params, matching the RLS
 * policies in `supabase/migrations/0001_tool_state.sql`.
 *
 * `setData` always fully replaces the value, mirroring every existing
 * Zustand store's `set` semantics — no partial-patch merge inside the hook.
 *
 * `useDeleteToolItem(toolId)` (Phase 1b addendum, below) is the delete
 * primitive for a per-item row — signed-in only, same user/tool scoping
 * discipline as the upsert path above.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'
import { supabase } from '../supabase/client'
import { useAuth } from '../auth/useAuth'
import { toolItemListQueryKey } from './useToolItemList'

export interface UseToolStateResult<T> {
  data: T
  setData: (next: T) => void
  isLoading: boolean
}

// ---------------------------------------------------------------------------
// Signed-out path — one shared Zustand persist store per (toolId, itemId).
// ---------------------------------------------------------------------------

interface LocalStoreState<T> {
  data: T
  setData: (next: T) => void
}

/** `su:<toolId>` for single-blob tools (itemId === 'default', matching the
 *  existing per-tool store convention exactly); `su:<toolId>:<itemId>` for
 *  any other item — new territory reserved for a future multi-item
 *  migration (e.g. markdown-editor's per-doc rows), not exercised by any
 *  real store yet. */
function localStorageKey(toolId: string, itemId: string): string {
  return itemId === 'default' ? `su:${toolId}` : `su:${toolId}:${itemId}`
}

type LocalStore<T> = {
  (): LocalStoreState<T>
  <U>(selector: (state: LocalStoreState<T>) => U): U
}

const localStoreCache = new Map<string, LocalStore<unknown>>()

function getLocalStore<T>(toolId: string, itemId: string, schema: z.ZodType<T>, defaultValue: T): LocalStore<T> {
  const key = localStorageKey(toolId, itemId)
  const cached = localStoreCache.get(key)
  if (cached) return cached as LocalStore<T>

  const store = create<LocalStoreState<T>>()(
    persist(
      (set) => ({
        data: defaultValue,
        setData: (next: T) => set({ data: next }),
      }),
      {
        name: key,
        merge: (persisted, current) => {
          const candidate = (persisted as { data?: unknown } | null)?.data
          const result = schema.safeParse(candidate)
          if (!result.success) return current
          return { ...current, data: result.data }
        },
      },
    ),
  ) as unknown as LocalStore<T>
  localStoreCache.set(key, store as LocalStore<unknown>)
  return store
}

// ---------------------------------------------------------------------------
// Signed-in path — React Query + Supabase.
// ---------------------------------------------------------------------------

export function toolStateQueryKey(userId: string | undefined, toolId: string, itemId: string) {
  return ['tool_state', userId, toolId, itemId] as const
}

// ---------------------------------------------------------------------------
// The hook.
// ---------------------------------------------------------------------------

export function useToolState<T>(
  toolId: string,
  itemId: string,
  schema: z.ZodType<T>,
  defaultValue: T,
): UseToolStateResult<T> {
  const { status, user } = useAuth()
  const userId = user?.id
  const signedIn = status === 'signed-in' && !!userId
  const queryClient = useQueryClient()

  // Always called (rules of hooks) — the local store backs the signed-out
  // path and is otherwise simply unread while signed in.
  const useLocalStore = getLocalStore(toolId, itemId, schema, defaultValue)
  const localData = useLocalStore((s) => s.data)
  const setLocalData = useLocalStore((s) => s.setData)

  const queryKey = toolStateQueryKey(userId, toolId, itemId)

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tool_state')
        .select('data')
        .eq('user_id', userId as string)
        .eq('tool_id', toolId)
        .eq('item_id', itemId)
        .maybeSingle()
      if (error) throw error
      return (data?.data ?? null) as unknown
    },
    enabled: signedIn,
  })

  const mutation = useMutation({
    mutationFn: async (next: T) => {
      const { error } = await supabase.from('tool_state').upsert({
        user_id: userId as string,
        tool_id: toolId,
        item_id: itemId,
        data: next,
      })
      if (error) throw error
      return next
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next)
    },
  })

  if (signedIn) {
    const parsed = schema.safeParse(query.data)
    return {
      data: parsed.success ? parsed.data : defaultValue,
      setData: (next: T) => mutation.mutate(next),
      isLoading: query.isLoading,
    }
  }

  return {
    data: localData,
    setData: setLocalData,
    isLoading: false,
  }
}

// ---------------------------------------------------------------------------
// useDeleteToolItem — signed-in-only delete primitive (Phase 1b addendum).
// ---------------------------------------------------------------------------

export interface UseDeleteToolItemResult {
  deleteItem: (itemId: string) => void
  isDeleting: boolean
}

/**
 * `useDeleteToolItem(toolId)` — deletes a single `tool_state` row for the
 * current session's user and the given `toolId`, scoped by the caller's own
 * `itemId` argument (never a caller-overridable `user_id`/`tool_id` — same
 * discipline as `useToolState`'s upsert path above).
 *
 * Signed-out is out of scope for this hook (see the Phase 1b contract) — it
 * is only ever called from a tool's signed-in path; the tool itself decides
 * which path to use, exactly as `useToolState` already does.
 *
 * A delete of a row that doesn't exist (already deleted, e.g. a
 * double-click race) is a no-op: Postgres/PostgREST returns success with
 * zero rows affected, not an error, so this never throws or surfaces an
 * error to the caller.
 *
 * On success, invalidates both this item's own `tool_state` query cache
 * entry and the `toolId`'s `useToolItemList` cache entry, so a consumer's
 * item list reflects the deletion without a manual refetch.
 */
export function useDeleteToolItem(toolId: string): UseDeleteToolItemResult {
  const { status, user } = useAuth()
  const userId = user?.id
  const signedIn = status === 'signed-in' && !!userId
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from('tool_state')
        .delete()
        .eq('user_id', userId as string)
        .eq('tool_id', toolId)
        .eq('item_id', itemId)
      if (error) throw error
      return itemId
    },
    onSuccess: (itemId) => {
      queryClient.removeQueries({ queryKey: toolStateQueryKey(userId, toolId, itemId) })
      queryClient.invalidateQueries({ queryKey: toolItemListQueryKey(userId, toolId) })
    },
  })

  return {
    // Defense in depth: this hook is only ever called from a tool's
    // signed-in path (per contract), but guard here too rather than
    // relying solely on the caller — never issue a delete with no
    // current session (RLS would reject it anyway, but this avoids the
    // wasted round-trip and keeps `userId` from ever being `undefined`
    // in the query builder call).
    deleteItem: (itemId: string) => {
      if (!signedIn) return
      mutation.mutate(itemId)
    },
    isDeleting: mutation.isPending,
  }
}
