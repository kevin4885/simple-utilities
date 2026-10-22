import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from './uiStore'

beforeEach(() => {
  useUiStore.setState({ activeTab: 'tools', rawDraft: null, draftNonce: 0 })
})

describe('useUiStore', () => {
  it('defaults activeTab to tools and rawDraft to null', () => {
    expect(useUiStore.getState().activeTab).toBe('tools')
    expect(useUiStore.getState().rawDraft).toBeNull()
  })

  it('setActiveTab switches tab', () => {
    useUiStore.getState().setActiveTab('raw')
    expect(useUiStore.getState().activeTab).toBe('raw')
  })

  it('setRawDraft stores the draft with an increasing nonce', () => {
    const { setRawDraft } = useUiStore.getState()
    setRawDraft({ method: 'ping', paramsText: '' })
    const first = useUiStore.getState().rawDraft
    expect(first).toMatchObject({ method: 'ping', paramsText: '' })
    setRawDraft({ method: 'ping', paramsText: '' })
    const second = useUiStore.getState().rawDraft
    expect(second!.nonce).toBeGreaterThan(first!.nonce)
  })

  it('setRawDraft(null) clears but later nonces still increase', () => {
    const { setRawDraft } = useUiStore.getState()
    setRawDraft({ method: 'a', paramsText: '{}' })
    const first = useUiStore.getState().rawDraft!.nonce
    setRawDraft(null)
    expect(useUiStore.getState().rawDraft).toBeNull()
    setRawDraft({ method: 'b', paramsText: '{}' })
    expect(useUiStore.getState().rawDraft!.nonce).toBeGreaterThan(first)
  })
})
