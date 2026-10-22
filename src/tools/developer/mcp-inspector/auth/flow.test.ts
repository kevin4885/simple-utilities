import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpSession } from '../connection/session'
import { getSecret, setSecret } from '../secrets'
import { useLogStore } from '../shell/logStore'
import { OAUTH_CHANNEL, type OAuthCallbackMessage } from './callback'
import { AUTH_TIMEOUT_MS, completeAuthorization, consumePendingOAuthReturn, startCallbackBuffer, stopCallbackBuffer } from './flow'

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
  sender.postMessage({ type: 'mcp-oauth-callback', state: null, code: null, iss: null, error: null, errorDescription: null, ...m })
  sender.close()
}
const listeners = () => FakeChannel.instances.filter((c) => c.name === OAUTH_CHANNEL && c.onmessage !== null)

function fakeSession(finishAuth: (code: string, iss?: string) => Promise<void> = async () => undefined) {
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
  stopCallbackBuffer()
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
    expect(finishAuth).toHaveBeenCalledWith('CODE-1', undefined)
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
    expect(finishAuth).toHaveBeenCalledWith('GOOD', undefined)
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

  it('passes the response iss to finishAuth unchanged (RFC 9207), and undefined when there is none', async () => {
    const withIss = fakeSession()
    const first = completeAuthorization(withIss.session, 'p1', new AbortController().signal)
    sendFromCallbackWindow({ state: 'STATE-1', code: 'c', iss: 'https://as.test' })
    await first
    expect(withIss.finishAuth).toHaveBeenCalledTimes(1)
    expect(withIss.finishAuth).toHaveBeenCalledWith('c', 'https://as.test')

    setSecret('oauth:p1:state', 'STATE-2', { persist: false })
    const without = fakeSession()
    const second = completeAuthorization(without.session, 'p1', new AbortController().signal)
    sendFromCallbackWindow({ state: 'STATE-2', code: 'c', iss: null })
    await second
    expect(without.finishAuth).toHaveBeenCalledTimes(1)
    expect(without.finishAuth).toHaveBeenCalledWith('c', undefined)
  })

  it('does not judge iss itself: a mismatching iss is still forwarded for the SDK to reject', async () => {
    const { session, finishAuth } = fakeSession(async () => {
      throw new Error('Issuer mismatch')
    })
    const done = completeAuthorization(session, 'p1', new AbortController().signal)
    sendFromCallbackWindow({ state: 'STATE-1', code: 'c', iss: 'https://evil.test' })
    await expect(done).rejects.toThrow('Issuer mismatch')
    expect(finishAuth).toHaveBeenCalledWith('c', 'https://evil.test')
  })
})

describe('lost-message buffer (callback posted before completeAuthorization is called)', () => {
  const open = () => FakeChannel.instances.filter((c) => !c.closed)

  it('delivers a message posted after the popup opened but before completeAuthorization, with its iss', async () => {
    const { session, finishAuth } = fakeSession()
    startCallbackBuffer() // what redirectToAuthorization does once the popup is open
    sendFromCallbackWindow({ state: 'STATE-1', code: 'EARLY', iss: 'https://as.test' })

    const done = completeAuthorization(session, 'p1', new AbortController().signal)
    await expect(done).resolves.toBeUndefined()
    expect(finishAuth).toHaveBeenCalledTimes(1)
    expect(finishAuth).toHaveBeenCalledWith('EARLY', 'https://as.test')
    expect(getSecret('oauth:p1:state')).toBeNull()
    expect(open()).toEqual([]) // buffer listener and flow channel are both closed
  })

  it('without a buffer an early message really is lost (the race this guards against)', async () => {
    const { session, finishAuth } = fakeSession()
    sendFromCallbackWindow({ state: 'STATE-1', code: 'EARLY' })
    const ac = new AbortController()
    const done = completeAuthorization(session, 'p1', ac.signal)
    await Promise.resolve()
    expect(finishAuth).not.toHaveBeenCalled()
    ac.abort()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('still ignores a buffered message whose state does not match, warns, and keeps waiting', async () => {
    const { session, finishAuth } = fakeSession()
    startCallbackBuffer()
    sendFromCallbackWindow({ state: 'FORGED', code: 'EVIL' })
    const done = completeAuthorization(session, 'p1', new AbortController().signal)
    let settled = false
    void done.then(() => (settled = true), () => (settled = true))

    await Promise.resolve()
    expect(finishAuth).not.toHaveBeenCalled()
    expect(settled).toBe(false)
    expect(events().some((e) => e.level === 'warn' && /state/i.test(e.text))).toBe(true)
    expect(JSON.stringify(events())).not.toContain('EVIL')
    expect(listeners()).toHaveLength(1)

    sendFromCallbackWindow({ state: 'STATE-1', code: 'GOOD' })
    await done
    expect(finishAuth).toHaveBeenCalledTimes(1)
    expect(finishAuth).toHaveBeenCalledWith('GOOD', undefined)
  })

  it('a buffered provider error rejects with its message', async () => {
    const { session, finishAuth } = fakeSession()
    startCallbackBuffer()
    sendFromCallbackWindow({ state: 'STATE-1', error: 'access_denied', errorDescription: 'No' })
    await expect(completeAuthorization(session, 'p1', new AbortController().signal)).rejects.toThrow('access_denied: No')
    expect(finishAuth).not.toHaveBeenCalled()
    expect(open()).toEqual([])
  })

  it('holds a single slot: the most recent message wins', async () => {
    const { session, finishAuth } = fakeSession()
    startCallbackBuffer()
    sendFromCallbackWindow({ state: 'STATE-1', code: 'OLD' })
    sendFromCallbackWindow({ state: 'STATE-1', code: 'NEW' })
    await completeAuthorization(session, 'p1', new AbortController().signal)
    expect(finishAuth).toHaveBeenCalledTimes(1)
    expect(finishAuth).toHaveBeenCalledWith('NEW', undefined)
  })

  it('ignores malformed messages (nothing is buffered for them)', async () => {
    const { session, finishAuth } = fakeSession()
    startCallbackBuffer()
    const other = new FakeChannel(OAUTH_CHANNEL)
    other.postMessage({ hello: 'world' })
    other.postMessage(null)
    other.postMessage({ type: 'mcp-oauth-callback', state: 'STATE-1', code: 'c', error: null, errorDescription: null }) // no iss key
    const ac = new AbortController()
    const done = completeAuthorization(session, 'p1', ac.signal)
    await Promise.resolve()
    expect(finishAuth).not.toHaveBeenCalled()
    ac.abort()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('is cleared once consumed: a later completeAuthorization does not see the same message again', async () => {
    const { session, finishAuth } = fakeSession()
    startCallbackBuffer()
    sendFromCallbackWindow({ state: 'FORGED', code: 'X' }) // taken and ignored by the first call
    const ac1 = new AbortController()
    const first = completeAuthorization(session, 'p1', ac1.signal)
    ac1.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })

    const ac2 = new AbortController()
    const second = completeAuthorization(session, 'p1', ac2.signal)
    await Promise.resolve()
    expect(events().filter((e) => e.level === 'warn')).toHaveLength(1) // not warned about twice
    expect(finishAuth).not.toHaveBeenCalled()
    ac2.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(open()).toEqual([])
  })

  it('is cleared on abort: an already-aborted call drops the buffered message and closes the listener', async () => {
    const { session, finishAuth } = fakeSession()
    startCallbackBuffer()
    sendFromCallbackWindow({ state: 'STATE-1', code: 'LATE' })
    const aborted = new AbortController()
    aborted.abort()
    await expect(completeAuthorization(session, 'p1', aborted.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(open()).toEqual([])

    const ac = new AbortController()
    const next = completeAuthorization(session, 'p1', ac.signal)
    await Promise.resolve()
    expect(finishAuth).not.toHaveBeenCalled() // the cancelled sign-in's message did not survive
    ac.abort()
    await expect(next).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('is cleared after 5 minutes and leaves no listener open', async () => {
    vi.useFakeTimers()
    const { session, finishAuth } = fakeSession()
    startCallbackBuffer()
    sendFromCallbackWindow({ state: 'STATE-1', code: 'STALE' })
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS - 1)
    expect(open()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(open()).toEqual([])

    const ac = new AbortController()
    const done = completeAuthorization(session, 'p1', ac.signal)
    await vi.advanceTimersByTimeAsync(0)
    expect(finishAuth).not.toHaveBeenCalled()
    ac.abort()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('starting a new sign-in drops a previous sign-in\'s buffered message and listener', async () => {
    const { session, finishAuth } = fakeSession()
    startCallbackBuffer()
    sendFromCallbackWindow({ state: 'STATE-1', code: 'PREVIOUS' })
    startCallbackBuffer()
    expect(open()).toHaveLength(1) // one listener, not two
    const ac = new AbortController()
    const done = completeAuthorization(session, 'p1', ac.signal)
    await Promise.resolve()
    expect(finishAuth).not.toHaveBeenCalled()
    ac.abort()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    expect(open()).toEqual([])
  })

  it('is a no-op where BroadcastChannel does not exist', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    expect(() => startCallbackBuffer()).not.toThrow()
    expect(FakeChannel.instances).toHaveLength(0)
  })
})

describe('consumePendingOAuthReturn', () => {
  const put = (value: unknown) => setSecret('oauth:pending-return', JSON.stringify(value), { persist: false })

  it('returns null and changes nothing when there is no marker', () => {
    expect(consumePendingOAuthReturn()).toBeNull()
  })

  it('returns the profile, code and state when the state matches, and clears marker and state', () => {
    put({ profileId: 'p1', code: 'CODE-1', state: 'STATE-1' })
    expect(consumePendingOAuthReturn()).toEqual({ profileId: 'p1', code: 'CODE-1', state: 'STATE-1', iss: null })
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

  it('returns the RFC 9207 iss from the marker as a string, or null when absent/empty/null', () => {
    put({ profileId: 'p1', code: 'C', state: 'STATE-1', iss: 'https://as.test' })
    expect(consumePendingOAuthReturn()).toEqual({ profileId: 'p1', code: 'C', state: 'STATE-1', iss: 'https://as.test' })
    for (const iss of [undefined, null, '']) {
      setSecret('oauth:p1:state', 'STATE-1', { persist: false })
      put({ profileId: 'p1', code: 'C', state: 'STATE-1', iss })
      expect(consumePendingOAuthReturn()).toEqual({ profileId: 'p1', code: 'C', state: 'STATE-1', iss: null })
    }
  })

  it('returns null (and clears the marker) when iss is present but neither a string nor null', () => {
    for (const iss of [42, true, {}, ['https://as.test']]) {
      put({ profileId: 'p1', code: 'C', state: 'STATE-1', iss })
      expect(consumePendingOAuthReturn()).toBeNull()
      expect(getSecret('oauth:pending-return')).toBeNull()
    }
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
