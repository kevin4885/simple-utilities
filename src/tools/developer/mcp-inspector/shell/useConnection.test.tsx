import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { UnauthorizedError, type Transport } from '@modelcontextprotocol/client'
import { createSession, type McpSession } from '../connection/session'
import type { SessionOptions } from '../connection/types'
import { createFakeServer, type FakeServerOptions } from '../testing/fakeServer'
import type { Profile } from '../schemas'
import { useMcpInspectorStore } from '../store'
import { setSecret } from '../secrets'

vi.mock('../auth/flow', () => ({
  completeAuthorization: vi.fn(),
  consumePendingOAuthReturn: vi.fn(() => null),
}))

import { completeAuthorization, consumePendingOAuthReturn } from '../auth/flow'
import { useLogStore } from './logStore'
import { useConnection } from './useConnection'

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'One',
    url: 'https://mcp.test/mcp',
    transport: 'streamable-http',
    protocolVersion: null,
    headers: [],
    persistSecrets: false,
    auth: { mode: 'none', scope: null, clientId: null },
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

interface Harness {
  createSessionFn: typeof createSession
  sessions: McpSession[]
  optionsSeen: SessionOptions[]
  fakes: ReturnType<typeof createFakeServer>[]
}

/** createSession wired to fake servers. `failFirst` makes the first N transport creations throw. */
function harness(fake: FakeServerOptions = {}, failFirst: Error[] = []): Harness {
  const h: Harness = { createSessionFn: createSession, sessions: [], optionsSeen: [], fakes: [] }
  let attempts = 0
  h.createSessionFn = (opts) => {
    h.optionsSeen.push(opts)
    const s = createSession({
      ...opts,
      transportFactory: () => {
        const err = failFirst[attempts++]
        if (err) throw err
        const f = createFakeServer({ serverInfo: { name: 'fake', version: '9.9' }, sessionId: 'sess-1', tools: [], ...fake })
        h.fakes.push(f)
        return f.clientTransport as Transport
      },
    })
    h.sessions.push(s)
    return s
  }
  return h
}

const events = () => useLogStore.getState().entries.filter((e) => e.kind === 'event').map((e) => (e as { text: string }).text)

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  useLogStore.getState().clear()
  useMcpInspectorStore.setState({ profiles: [], activeProfileId: null })
  vi.mocked(completeAuthorization).mockReset()
  vi.mocked(consumePendingOAuthReturn).mockReset().mockReturnValue(null)
})
afterEach(() => vi.useRealTimers())

describe('useConnection', () => {
  it('goes Disconnected -> Connecting -> Connected -> Disconnected', async () => {
    const h = harness({ latencyMs: 30 })
    const { result } = renderHook(() => useConnection(profile(), { createSessionFn: h.createSessionFn }))
    expect(result.current.state.status).toBe('disconnected')
    expect(result.current.session).toBeNull()

    let done!: Promise<void>
    act(() => {
      done = result.current.connect()
    })
    await waitFor(() => expect(result.current.state.status).toBe('connecting'))
    expect(result.current.session).toBeNull()
    await act(async () => {
      await done
    })
    expect(result.current.state.status).toBe('connected')
    expect(result.current.info).toMatchObject({ serverName: 'fake', serverVersion: '9.9', sessionId: 'sess-1' })
    expect(result.current.session).toBe(h.sessions[0])
    expect(result.current.sessionOptions?.config.url).toBe('https://mcp.test/mcp')
    expect(result.current.epoch).toBe(1)
    // the log store received the connection traffic via onLog
    expect(useLogStore.getState().entries.some((e) => e.kind === 'rpc')).toBe(true)

    await act(async () => {
      await result.current.disconnect()
    })
    expect(result.current.state.status).toBe('disconnected')
    expect(result.current.session).toBeNull()
    expect(result.current.info).toBeNull()
  })

  it('increments the epoch on every successful connect', async () => {
    const h = harness()
    const { result } = renderHook(() => useConnection(profile(), { createSessionFn: h.createSessionFn }))
    await act(async () => void (await result.current.connect()))
    expect(result.current.epoch).toBe(1)
    await act(async () => void (await result.current.connect()))
    expect(result.current.state.status).toBe('connected')
    expect(result.current.epoch).toBe(2)
    expect(h.sessions).toHaveLength(2)
  })

  it('uses the secret header value from secrets.ts (not from the profile) for the connection config', async () => {
    setSecret('hdr:p1:h1', 'Bearer TOP', { persist: false })
    const h = harness()
    const p = profile({ headers: [{ id: 'h1', name: 'Authorization', value: '', secret: true, enabled: true }] })
    const { result } = renderHook(() => useConnection(p, { createSessionFn: h.createSessionFn }))
    await act(async () => void (await result.current.connect()))
    expect(h.optionsSeen[0].config.headers).toEqual([{ name: 'Authorization', value: 'Bearer TOP' }])
  })

  it('does not connect when a header name is invalid and explains why', async () => {
    const h = harness()
    const p = profile({ headers: [{ id: 'h1', name: 'Bad Name', value: 'x', secret: false, enabled: true }] })
    const { result } = renderHook(() => useConnection(p, { createSessionFn: h.createSessionFn }))
    await act(async () => void (await result.current.connect()))
    expect(h.sessions).toHaveLength(0)
    expect(result.current.state).toMatchObject({ status: 'error', diagnosis: { title: 'Invalid header name' } })
  })

  it('shows the diagnosis when the connection fails', async () => {
    const h = harness({}, [new TypeError('Failed to fetch')])
    const { result } = renderHook(() => useConnection(profile(), { createSessionFn: h.createSessionFn }))
    await act(async () => void (await result.current.connect()))
    expect(result.current.state).toMatchObject({ status: 'error', diagnosis: { code: 'cors-or-network' } })
  })

  it('switching profile while connected disconnects first', async () => {
    const h = harness()
    const { result, rerender } = renderHook(({ p }) => useConnection(p, { createSessionFn: h.createSessionFn }), {
      initialProps: { p: profile() },
    })
    await act(async () => void (await result.current.connect()))
    const spy = vi.spyOn(h.sessions[0], 'disconnect')
    rerender({ p: profile({ id: 'p2', name: 'Two' }) })
    await waitFor(() => expect(result.current.state.status).toBe('disconnected'))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.current.session).toBeNull()
  })

  it('unmounting disconnects the live session', async () => {
    const h = harness()
    const { result, unmount } = renderHook(() => useConnection(profile(), { createSessionFn: h.createSessionFn }))
    await act(async () => void (await result.current.connect()))
    const spy = vi.spyOn(h.sessions[0], 'disconnect')
    unmount()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  describe('auth-required', () => {
    it('waits for authorization with an AbortSignal, then connects again on resolve', async () => {
      const h = harness({}, [new UnauthorizedError()])
      let release!: () => void
      vi.mocked(completeAuthorization).mockImplementation(
        () => new Promise<void>((resolve) => (release = resolve)),
      )
      const { result } = renderHook(() => useConnection(profile(), { createSessionFn: h.createSessionFn }))

      let done!: Promise<void>
      act(() => {
        done = result.current.connect()
      })
      await waitFor(() => expect(completeAuthorization).toHaveBeenCalled())
      await waitFor(() => expect(result.current.state.status).toBe('auth-required'))
      const [sessionArg, profileIdArg, signalArg] = vi.mocked(completeAuthorization).mock.calls[0]
      expect(sessionArg).toBe(h.sessions[0])
      expect(profileIdArg).toBe('p1')
      expect(signalArg).toBeInstanceOf(AbortSignal)
      expect(signalArg.aborted).toBe(false)

      await act(async () => {
        release()
        await done
      })
      expect(result.current.state.status).toBe('connected')
      // the retry reused the same session
      expect(h.sessions).toHaveLength(1)
    })

    it('Cancel aborts the wait, ends Disconnected and logs an event', async () => {
      const h = harness({}, [new UnauthorizedError()])
      vi.mocked(completeAuthorization).mockImplementation(
        (_s, _p, signal) =>
          new Promise<void>((_, reject) =>
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
          ),
      )
      const { result } = renderHook(() => useConnection(profile(), { createSessionFn: h.createSessionFn }))
      let done!: Promise<void>
      act(() => {
        done = result.current.connect()
      })
      await waitFor(() => expect(completeAuthorization).toHaveBeenCalled())
      const signal = vi.mocked(completeAuthorization).mock.calls[0][2]

      await act(async () => {
        await result.current.cancelAuth()
        await done
      })
      expect(signal.aborted).toBe(true)
      expect(result.current.state.status).toBe('disconnected')
      expect(events().some((t) => /cancel/i.test(t))).toBe(true)
      // no second connect attempt was made
      expect(h.fakes).toHaveLength(0)
    })

    it('a rejected authorization ends in an error diagnosis containing the message', async () => {
      const h = harness({}, [new UnauthorizedError()])
      vi.mocked(completeAuthorization).mockRejectedValue(new Error('access_denied: user said no'))
      const { result } = renderHook(() => useConnection(profile(), { createSessionFn: h.createSessionFn }))
      await act(async () => void (await result.current.connect()))
      expect(result.current.state.status).toBe('error')
      const state = result.current.state
      if (state.status !== 'error') throw new Error('unreachable')
      expect(['unknown', 'unauthorized']).toContain(state.diagnosis.code)
      expect(state.diagnosis.detail).toContain('access_denied: user said no')
    })

    it('ends in an error if the server still wants authorization after sign-in', async () => {
      const h = harness({}, [new UnauthorizedError(), new UnauthorizedError()])
      vi.mocked(completeAuthorization).mockResolvedValue(undefined)
      const { result } = renderHook(() => useConnection(profile(), { createSessionFn: h.createSessionFn }))
      await act(async () => void (await result.current.connect()))
      expect(result.current.state).toMatchObject({ status: 'error', diagnosis: { code: 'unauthorized' } })
    })
  })

  describe('returning from a full-page OAuth redirect', () => {
    it('selects the profile, calls session.finishAuth(code), then connects', async () => {
      const target = profile({ id: 'p2', name: 'Two' })
      useMcpInspectorStore.setState({ profiles: [profile(), target], activeProfileId: 'p1' })
      vi.mocked(consumePendingOAuthReturn).mockReturnValueOnce({ profileId: 'p2', code: 'the-code', state: 's' })
      const h = harness()
      const finish = vi.fn(async () => undefined)
      const base = h.createSessionFn
      const fn: typeof createSession = (opts) => {
        const s = base(opts)
        s.finishAuth = finish
        return s
      }
      const { result } = renderHook(() => useConnection(target, { createSessionFn: fn }))
      await waitFor(() => expect(result.current.state.status).toBe('connected'))
      expect(finish).toHaveBeenCalledWith('the-code')
      expect(useMcpInspectorStore.getState().activeProfileId).toBe('p2')
      expect(consumePendingOAuthReturn).toHaveBeenCalledTimes(1)
    })

    it('does nothing when there is no pending return', async () => {
      const h = harness()
      const { result } = renderHook(() => useConnection(profile(), { createSessionFn: h.createSessionFn }))
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10))
      })
      expect(result.current.state.status).toBe('disconnected')
      expect(h.sessions).toHaveLength(0)
    })

    it('reports an error when finishAuth fails', async () => {
      useMcpInspectorStore.setState({ profiles: [profile()], activeProfileId: 'p1' })
      vi.mocked(consumePendingOAuthReturn).mockReturnValueOnce({ profileId: 'p1', code: 'bad', state: 's' })
      const h = harness()
      const base = h.createSessionFn
      const fn: typeof createSession = (opts) => {
        const s = base(opts)
        s.finishAuth = vi.fn(async () => {
          throw new Error('invalid_grant')
        })
        return s
      }
      const { result } = renderHook(() => useConnection(profile(), { createSessionFn: fn }))
      await waitFor(() => expect(result.current.state.status).toBe('error'))
      const state = result.current.state
      if (state.status !== 'error') throw new Error('unreachable')
      expect(state.diagnosis.detail).toContain('invalid_grant')
    })
  })
})
