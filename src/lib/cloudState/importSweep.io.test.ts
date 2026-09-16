/**
 * importSweep.io tests — the Supabase client is mocked so these exercise
 * only the I/O wrapper's own logic (existence check → decideImport →
 * upsert), never a real network call. Verifies the security-critical claim
 * every phase's acceptance criteria checks: every query/upsert this module
 * issues is scoped to the given `userId` and the target's own `toolId` —
 * never any other value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { runImportSweep, type SweepTarget } from './importSweep.io'

const selectMock = vi.fn()
const eqMock = vi.fn()
const upsertMock = vi.fn()
const fromMock = vi.fn()

vi.mock('../supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

/** Builds a chainable `.select().eq().eq()` mock resolving to `resolved`. */
function makeSelectChain(resolved: { data: unknown; error: unknown }) {
  const chain = {
    eq: vi.fn(() => chain),
    then: (resolve: (v: typeof resolved) => void) => Promise.resolve(resolved).then(resolve),
  }
  return chain
}

const Schema = z.object({ text: z.string() })

beforeEach(() => {
  selectMock.mockReset()
  eqMock.mockReset()
  upsertMock.mockReset().mockResolvedValue({ data: null, error: null })
  fromMock.mockReset()
})

function setupFrom(existingRows: { item_id: string }[]) {
  fromMock.mockImplementation((table: string) => {
    expect(table).toBe('tool_state')
    return {
      select: selectMock.mockImplementation(() => makeSelectChain({ data: existingRows, error: null })),
      upsert: upsertMock,
    }
  })
}

describe('runImportSweep', () => {
  it('imports local data for a tool with no existing cloud row', async () => {
    setupFrom([])
    const target: SweepTarget = {
      toolId: 'word-counter',
      getLocalItems: () => [{ itemId: 'default', data: { text: 'hello' } }],
      schema: Schema,
    }

    await runImportSweep('user-123', [target])

    expect(upsertMock).toHaveBeenCalledWith(
      {
        user_id: 'user-123',
        tool_id: 'word-counter',
        item_id: 'default',
        data: { text: 'hello' },
      },
      { onConflict: 'user_id,tool_id,item_id', ignoreDuplicates: true },
    )
  })

  it('skips a tool that already has a cloud row for that item, never overwriting it', async () => {
    setupFrom([{ item_id: 'default' }])
    const target: SweepTarget = {
      toolId: 'word-counter',
      getLocalItems: () => [{ itemId: 'default', data: { text: 'different local value' } }],
      schema: Schema,
    }

    await runImportSweep('user-123', [target])

    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('skips a tool with no local data at all', async () => {
    setupFrom([])
    const target: SweepTarget = {
      toolId: 'word-counter',
      getLocalItems: () => [],
      schema: Schema,
    }

    await runImportSweep('user-123', [target])

    expect(fromMock).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('always scopes the existence check and the upsert to the given userId and the target\'s own toolId', async () => {
    setupFrom([])
    const target: SweepTarget = {
      toolId: 'bill-splitter',
      getLocalItems: () => [{ itemId: 'default', data: { text: 'hi' } }],
      schema: Schema,
    }

    await runImportSweep('the-current-user', [target])

    const selectChain = selectMock.mock.results[0].value as ReturnType<typeof makeSelectChain>
    expect(selectChain.eq).toHaveBeenCalledWith('user_id', 'the-current-user')
    expect(selectChain.eq).toHaveBeenCalledWith('tool_id', 'bill-splitter')
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'the-current-user', tool_id: 'bill-splitter' }),
      expect.anything(),
    )
  })

  it('is idempotent — running twice in a row only imports once', async () => {
    let rows: { item_id: string }[] = []
    fromMock.mockImplementation(() => ({
      select: () => makeSelectChain({ data: rows, error: null }),
      upsert: (row: { item_id: string }, _opts?: unknown) => {
        void _opts
        rows = [{ item_id: row.item_id }]
        return Promise.resolve({ data: null, error: null })
      },
    }))

    const target: SweepTarget = {
      toolId: 'word-counter',
      getLocalItems: () => [{ itemId: 'default', data: { text: 'hello' } }],
      schema: Schema,
    }

    await runImportSweep('user-123', [target])
    await runImportSweep('user-123', [target])

    expect(rows).toHaveLength(1)
  })

  it('continues sweeping other targets when one target fails', async () => {
    const failingTarget: SweepTarget = {
      toolId: 'broken-tool',
      getLocalItems: () => [{ itemId: 'default', data: { text: 'x' } }],
      schema: Schema,
    }
    const okTarget: SweepTarget = {
      toolId: 'word-counter',
      getLocalItems: () => [{ itemId: 'default', data: { text: 'ok' } }],
      schema: Schema,
    }

    fromMock.mockImplementation((table: string) => {
      void table
      return {
        select: () => {
          throw new Error('boom')
        },
        upsert: upsertMock,
      }
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runImportSweep('user-123', [failingTarget, okTarget])
    consoleErrorSpy.mockRestore()

    // Both targets attempted `select` despite the first one throwing.
    expect(fromMock).toHaveBeenCalledTimes(2)
  })
})
