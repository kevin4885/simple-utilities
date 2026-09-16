/**
 * url-parser/store.test.ts
 *
 * Import-sweep registration coverage (Phase 3b of google-auth-cloud-state):
 * confirms this tool registers itself with the sweep at module load, with
 * the correct `toolId`, and that its `getLocalItems()` reflects the local
 * (signed-out) store's current data.
 */
import { describe, it, expect, vi } from 'vitest'

const { registerSweepTargetMock } = vi.hoisted(() => ({ registerSweepTargetMock: vi.fn() }))
vi.mock('@/lib/cloudState/importSweep.io', () => ({
  registerSweepTarget: (...args: unknown[]) => registerSweepTargetMock(...args),
}))

import { useUrlParserStore } from './store'

describe('import-sweep registration', () => {
  it("registers a sweep target with the correct toolId and getLocalItems() reflecting the local store's current data", () => {
    expect(registerSweepTargetMock).toHaveBeenCalledTimes(1)
    const target = registerSweepTargetMock.mock.calls[0][0]
    expect(target.toolId).toBe('url-parser')

    useUrlParserStore.setState({ urlInput: 'https://example.com', encodeMode: 'decodeURI' })

    const items = target.getLocalItems()
    expect(items).toEqual([
      {
        itemId: 'default',
        data: expect.objectContaining({ urlInput: 'https://example.com', encodeMode: 'decodeURI' }),
      },
    ])
  })
})
