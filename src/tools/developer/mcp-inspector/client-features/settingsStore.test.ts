import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './logic'
import { CLIENT_SETTINGS_KEY, mergePersisted, parseSettings, useClientSettings } from './settingsStore'

beforeEach(() => {
  localStorage.clear()
  useClientSettings.setState({ ...DEFAULT_SETTINGS })
})

describe('parseSettings (rehydrate validation)', () => {
  it('uses the C9 defaults for garbage', () => {
    for (const junk of [undefined, null, 5, 'x', [], { roots: 3, sampling: 'yes', elicitation: [], loggingLevel: 'loud' }]) {
      expect(parseSettings(junk)).toEqual(DEFAULT_SETTINGS)
    }
  })
  it('keeps valid fields and defaults only the invalid ones', () => {
    expect(
      parseSettings({
        roots: { enabled: true, items: [{ uri: 'file:///a', name: 'A' }] },
        sampling: { enabled: 'nope' },
        elicitation: { enabled: true },
        loggingLevel: 'error',
      }),
    ).toEqual({
      roots: { enabled: true, items: [{ uri: 'file:///a', name: 'A' }] },
      sampling: { enabled: false },
      elicitation: { enabled: true },
      loggingLevel: 'error',
    })
  })
  it('drops invalid, duplicate and non-object root rows', () => {
    const s = parseSettings({
      roots: {
        enabled: true,
        items: [
          { uri: 'file:///ok', name: null },
          { uri: 'no-scheme', name: null },
          { uri: 5, name: null },
          { uri: 'file:///ok', name: 'dup' },
          'file:///string',
          { uri: 'https://x.test/r', name: '  spaced  ' },
          { uri: 'file:///c' },
        ],
      },
    })
    expect(s.roots.items).toEqual([
      { uri: 'file:///ok', name: null },
      { uri: 'https://x.test/r', name: 'spaced' },
    ])
  })
  it('mergePersisted never throws and keeps the actions of the current state', () => {
    const merged = mergePersisted({ loggingLevel: 'debug' }, useClientSettings.getState())
    expect(merged.loggingLevel).toBe('debug')
    expect(typeof merged.addRoot).toBe('function')
  })
})

describe('useClientSettings', () => {
  it('starts with the defaults and persists under su:mcp-inspector-client', () => {
    expect(useClientSettings.getState().roots).toEqual({ enabled: false, items: [] })
    useClientSettings.getState().setSamplingEnabled(true)
    const stored = JSON.parse(localStorage.getItem(CLIENT_SETTINGS_KEY) ?? 'null')
    expect(stored.state.sampling).toEqual({ enabled: true })
    expect(CLIENT_SETTINGS_KEY).toBe('su:mcp-inspector-client')
  })

  it('addRoot trims, stores and returns null on success', () => {
    expect(useClientSettings.getState().addRoot('  file:///work  ', ' Work ')).toBeNull()
    expect(useClientSettings.getState().roots.items).toEqual([{ uri: 'file:///work', name: 'Work' }])
  })
  it('addRoot rejects an invalid row with an inline error and does not store it', () => {
    const s = useClientSettings.getState()
    expect(s.addRoot('not a uri', '')).toMatch(/scheme|spaces/)
    expect(s.addRoot('', '')).toMatch(/Enter a root URI/)
    expect(s.addRoot('/etc', '')).toMatch(/scheme/)
    expect(useClientSettings.getState().roots.items).toEqual([])
  })
  it('addRoot rejects duplicates and removeRoot deletes by index', () => {
    const s = useClientSettings.getState()
    s.addRoot('file:///a', '')
    expect(s.addRoot('file:///a', 'again')).toMatch(/already/)
    s.addRoot('file:///b', '')
    s.removeRoot(0)
    expect(useClientSettings.getState().roots.items).toEqual([{ uri: 'file:///b', name: null }])
  })
  it('setters update only their own field', () => {
    const s = useClientSettings.getState()
    s.setRootsEnabled(true)
    s.setElicitationEnabled(true)
    s.setLoggingLevel('warning')
    expect(useClientSettings.getState()).toMatchObject({
      roots: { enabled: true, items: [] },
      sampling: { enabled: false },
      elicitation: { enabled: true },
      loggingLevel: 'warning',
    })
  })
})
