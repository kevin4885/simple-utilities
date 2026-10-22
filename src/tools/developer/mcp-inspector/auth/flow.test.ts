import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpSession } from '../connection/session'
import { getSecret, setSecret } from '../secrets'
import { useLogStore } from '../shell/logStore'
import { OAUTH_CHANNEL, type OAuthCallbackMessage } from './callback'
import { AUTH_TIMEOUT_MS, completeAuthorization, consumePendingOAuthReturn } from './flow'

/** In-memory BroadcastChannel: same-name instances see each other's messages, synchronously. */
class FakeChannel {
  static instances: FakeChannel[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  closed = false
  constructor(readonly name: string) {
    FakeChannel.instances.push(this)
  }
  postMessage(data: unknown): void {
    for (const other of FakeChannel.instances) {
      if (other !== this && !other.closed && other.name === this.name) other.onmessage?.({ data } as MessageEvent)
    }
  }
  close(): void {
    this.closed = true
  }
}

const sendFromCallbackWindow = (m: Partial<OAuthCallbackMessage>) => {
  const sender = new FakeChannel(OAUTH_CHANNEL)
  sender.postMessage({ type: 'mcp-oauth-callback', state: null, code: null, error: null, errorDescription: null, ...m })
  sender.close()
}
const listeners = () => FakeChannel.instances.filter((c) => c.name === OAUTH_CHANNEL && c.onmessage !== null)

function fakeSession(finishAuth: (code: string) => Promise<void> = async () => undefined) {
  const spy = vi.fn(finishAuth)
  return { session: { finishAuth: spy } as unknown as McpSession, finishAuth: spy }
}

const events = () => useLogStore.getState().entries.filter((e) => e.kind === 'event')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  FakeChannel.instances = []
  vi.stubGlobal('BroadcastChannel', FakeChannel)
  useLogStore.setState({ entries: [] })
  setSecret('oauth:p1:state', 'STATE-1', { persist: false })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('completeAuthorization', () => {
  it('resolves after a matching-state message with a code, calling finishAuth(code) once', async () => {
    const { session, finishAuth } = fakeSession()
    const done = completeAuthorization(session, 'p1', new AbortController().signal)
    sendFromCallbackWindow({ state: 'STATE-1', code: 'CODE-1' })
    await expect(done).resolves.toBeUndefined()
    expect(finishAuth).toHaveBeenCalledTimes(1)
    expect(finishAuth).toHaveBeenCalledWith('CODE-1')
    expect(FakeChannel.instances.filter((c) => !c.closed)).toEqual([])
  })

  it('consumes the state: a replayed response with the same state is ignored', async () => {
    const { session, finishAuth } = fakeSession()
    const done = completeAuthorization(session, 'p1', new AbortController().signal)
    sendFromCallbackWindow({ state: 'STATE-1', code: 'CODE-1' })
    await done
    // a second attempt waits again; the old state is gone, so replaying it does nothing
    const second = completeAuthorization(session, 'p1', new AbortController().signal)
    sendFromCallbackWindow({ state: 'STATE-1', code: 'CODE-2' })
    expect(finishAuth).toHaveBeenCalledTimes(1)
    expect(getSecret('oauth:p1:state')).toBeNull()
    // settle the pending promise so it does not linger
    const ac = new AbortController()
    void second.catch(() => undefined)
    ac.abort()
  })

  it('ignores a message with a non-matching state, logs a warning, and keeps waiting', async () => {
    const { session, finishAuth } = fakeSession()
    const done = completeAuthorization(session, 'p1', new AbortController().signal)
    let settled = false
    void done.then(() => (settled = true), () => (settled = true))

    sendFromCallbackWindow({ state: 'FORGED', code: 'EVIL' })
    await Promise.resolve()
    expect(finishAuth).not.toHaveBeenCalled()
    expect(settled).toBe(false)
    expect(events().some((e) => e.level === 'warn' && /state/i.test(e.text))).toBe(true)
    expect(JSON.stringify(events())).not.toContain('EVIL')
    expect(listeners()).toHaveLength(1) // still listening

    sendFromCallbackWindow({ state: 'STATE-1', code: 'GOOD' })
    await done
    expect(finishAuth).toHaveBeenCalledWith('GOOD')
  })

  it('ignores a response without any state and a response when no attempt is pending', async () => {
    const { session, finishAuth } = fakeSession()
    const ac = new AbortController()
    const done = completeAuthorization(session, 'p1', ac.signal)
    sendFromCallbackWindow({ state: null, code: 'NOSTATE' })
    expect(finishAuth).not.toHaveBeenCalled()
    ac.abort()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })

    setSecret('oauth:p1:state', '', { persist: false })
    const done2 = completeAuthorization(session, 'p1', ac.signal.aborted ? new AbortController().signal : ac.signal)
    sendFromCallbackWindow({ state: '', code: 'EMPTY' })
    expect(finishAuth).not.toHaveBeenCalled()
    void done2.catch(() => undefined)
  })

  it('ignores malformed messages from other senders', async () => {
    const { session, finishAuth } = fakeSession()
    const ac = new AbortController()
    const done = completeAuthorization(session, 'p1', ac.signal)
    const other = new FakeChannel(OAUTH_CHANNEL)
    other.postMessage({ hello: 'world' })
    other.postMessage('mcp-oauth-callback')
    other.postMessage(null)
    expect(finishAuth).not.toHaveBeenCalled()
    ac.abort()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects with the provider error including its description, and closes the channel', async () => {
    const { session, finishAuth } = fakeSession()
    const done = completeAuthorization(session, 'p1', new AbortController().signal)
    sendFromCallbackWindow({ state: 'STATE-1', error: 'access_denied', errorDescription: 'User said no' })
    await expect(done).rejects.toThrow('access_denied: User said no')
    expect(finishAuth).not.toHaveBeenCalled()
    expect(FakeChannel.instances.filter((c) => !c.closed)).toEqual([])
  })

  it('an error response carrying a different state is ignored; one without state is accepted', async () => {
    const { session } = fakeSession()
    const done = completeAuthorization(session, 'p1', new AbortController().signal)
    sendFromCallbackWindow({ state: 'FORGED', error: 'access_denied' })
    expect(listeners()).toHaveLength(1)
    sendFromCallbackWindow({ error: 'server_error' })
    await expect(done).rejects.toThrow('server_error')
  })

  it('abort rejects with AbortError and closes the channel', async () => {
    const { session, finishAuth } = fakeSession()
    const ac = new AbortController()
    const done = completeAuthorization(session, 'p1', ac.signal)
    ac.abort()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    expect(finishAuth).not.toHaveBeenCalled()
    expect(FakeChannel.instances.every((c) => c.closed)).toBe(true)
  })

  it('an already-aborted signal rejects immediately without opening a channel', async () => {
    const { session } = fakeSession()
    const ac = new AbortController()
    ac.abort()
    await expect(completeAuthorization(session, 'p1', ac.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeChannel.instances).toHaveLength(0)
  })

  it('5 minutes of silence rejects with a timeout message and closes the channel', async () => {
    vi.useFakeTimers()
    const { session } = fakeSession()
    const done = completeAuthorization(session, 'p1', new AbortController().signal)
    const assertion = expect(done).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS - 1)
    expect(listeners()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
    expect(AUTH_TIMEOUT_MS).toBe(300000)
    expect(FakeChannel.instances.every((c) => c.closed)).toBe(true)
  })

  it('a finishAuth failure rejects with its message and closes the channel', async () => {
    const { session } = fakeSession(async () => {
      throw new Error('invalid_grant: code expired')
    })
    const done = completeAuthorization(session, 'p1', new AbortController().signal)
    sendFromCallbackWindow({ state: 'STATE-1', code: 'CODE-1' })
    await expect(done).rejects.toThrow('invalid_grant: code expired')
    expect(FakeChannel.instances.every((c) => c.closed)).toBe(true)
  })

  it('a network failure while redeeming the code becomes the CORS checklist', async () => {
    const { session } = fakeSession(async () => {
      throw new Error('Failed to fetch')
    })
    const done = completeAuthorization(session, 'p1', new AbortController().signal)
    sendFromCallbackWindow({ state: 'STATE-1', code: 'CODE-1' })
    await expect(done).rejects.toThrow(/Access-Control-Allow-Origin/)
  })

  it('abort while finishAuth is running still rejects with AbortError', async () => {
    let release!: () => void
    const { session } = fakeSession(() => new Promise<void>((r) => (release = r)))
    const ac = new AbortController()
    const done = completeAuthorization(session, 'p1', ac.signal)
    sendFromCallbackWindow({ state: 'STATE-1', code: 'CODE-1' })
    ac.abort()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    release()
  })
})

describe('consumePendingOAuthReturn', () => {
  const put = (value: unknown) => setSecret('oauth:pending-return', JSON.stringify(value), { persist: false })

  it('returns null and changes nothing when there is no marker', () => {
    expect(consumePendingOAuthReturn()).toBeNull()
  })

  it('returns the profile, code and state when the state matches, and clears marker and state', () => {
    put({ profileId: 'p1', code: 'CODE-1', state: 'STATE-1' })
    expect(consumePendingOAuthReturn()).toEqual({ profileId: 'p1', code: 'CODE-1', state: 'STATE-1' })
    expect(getSecret('oauth:pending-return')).toBeNull()
    expect(getSecret('oauth:p1:state')).toBeNull()
    expect(consumePendingOAuthReturn()).toBeNull() // read-and-clear
  })

  it('rejects (and still clears) a response whose state does not match this attempt', () => {
    put({ profileId: 'p1', code: 'EVIL', state: 'FORGED' })
    expect(consumePendingOAuthReturn()).toBeNull()
    expect(getSecret('oauth:pending-return')).toBeNull()
    expect(events().some((e) => e.level === 'warn')).toBe(true)
    expect(getSecret('oauth:p1:state')).toBe('STATE-1') // the real attempt is untouched
  })

  it('rejects a marker that was never completed (only {profileId}) or lacks state', () => {
    put({ profileId: 'p1' })
    expect(consumePendingOAuthReturn()).toBeNull()
    put({ profileId: 'p1', code: 'C' })
    expect(consumePendingOAuthReturn()).toBeNull()
    put({ profileId: 'p1', state: 'STATE-1' })
    expect(consumePendingOAuthReturn()).toBeNull()
  })

  it('rejects corrupt or incomplete markers', () => {
    setSecret('oauth:pending-return', 'not json', { persist: false })
    expect(consumePendingOAuthReturn()).toBeNull()
    put('string')
    expect(consumePendingOAuthReturn()).toBeNull()
    put({ code: 'C', state: 'STATE-1' })
    expect(consumePendingOAuthReturn()).toBeNull()
  })

  it('logs a provider error and returns null', () => {
    put({ profileId: 'p1', error: 'access_denied', errorDescription: 'No', state: 'STATE-1' })
    expect(consumePendingOAuthReturn()).toBeNull()
    expect(events().some((e) => e.level === 'error' && e.text.includes('access_denied') && e.text.includes('No'))).toBe(true)
    expect(getSecret('oauth:pending-return')).toBeNull()
  })

  it('ignores a provider error that carries another attempt\'s state', () => {
    put({ profileId: 'p1', error: 'access_denied', state: 'FORGED' })
    expect(consumePendingOAuthReturn()).toBeNull()
    expect(events()).toHaveLength(0)
  })
})
