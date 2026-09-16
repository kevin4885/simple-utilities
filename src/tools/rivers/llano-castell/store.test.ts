/**
 * llano-castell/store.test.ts
 *
 * Import-sweep registration coverage (Phase 3b of google-auth-cloud-state):
 * confirms this tool registers itself with the sweep at module load, with
 * the correct `toolId`, and that its `getLocalItems()` reflects the local
 * (signed-out) store's current cache data.
 */
import { describe, it, expect, vi } from 'vitest'

const { registerSweepTargetMock } = vi.hoisted(() => ({ registerSweepTargetMock: vi.fn() }))
vi.mock('@/lib/cloudState/importSweep.io', () => ({
  registerSweepTarget: (...args: unknown[]) => registerSweepTargetMock(...args),
}))

import { useLlanoCastellStore } from './store'

describe('import-sweep registration', () => {
  it("registers a sweep target with the correct toolId and getLocalItems() reflecting the local store's current data", () => {
    expect(registerSweepTargetMock).toHaveBeenCalledTimes(1)
    const target = registerSweepTargetMock.mock.calls[0][0]
    expect(target.toolId).toBe('llano-castell')

    const cache = {
      fetchedAtMs: 12345,
      mason: [{ dateTime: '2024-01-01T00:00:00Z', value: 2 }],
      llano: [],
      masonFt: [],
      llanoFt: [],
    }
    useLlanoCastellStore.getState().setCache(cache)

    const items = target.getLocalItems()
    expect(items).toEqual([
      {
        itemId: 'default',
        data: expect.objectContaining({ fetchedAtMs: 12345 }),
      },
    ])
  })
})
