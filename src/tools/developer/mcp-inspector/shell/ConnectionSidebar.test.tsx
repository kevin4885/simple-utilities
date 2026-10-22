import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./viewerIo', async (orig) => ({
  ...(await orig<typeof import('./viewerIo')>()),
  downloadBlob: vi.fn(),
  copyText: vi.fn().mockResolvedValue(true),
}))

import { downloadBlob } from './viewerIo'
import { PERSISTED_SECRETS_KEY, SESSION_SECRETS_KEY, getSecret } from '../secrets'
import { STORE_KEY, useMcpInspectorStore } from '../store'
import { ConnectionSidebar } from './ConnectionSidebar'

function allLocalText(): string {
  let out = ''
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    out += `${k}=${localStorage.getItem(k)}\n`
  }
  return out
}

const store = () => useMcpInspectorStore.getState()
const active = () => store().profiles.find((p) => p.id === store().activeProfileId)!

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  useMcpInspectorStore.setState({ profiles: [], activeProfileId: null, history: [] })
  vi.mocked(downloadBlob).mockClear()
  // jsdom lacks the DOM APIs Radix Select touches when its listbox opens.
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

describe('profile list', () => {
  it('shows an empty state, then lists profiles by name with New', async () => {
    const user = userEvent.setup()
    render(<ConnectionSidebar />)
    expect(screen.getByText(/No profiles yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New' }))
    expect(screen.getByRole('button', { name: 'New profile' })).toBeInTheDocument()
    expect(store().profiles).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'New' }))
    expect(within(screen.getByRole('list', { name: 'Profiles' })).getAllByRole('button')).toHaveLength(2)
  })

  it('clicking a profile makes it active', async () => {
    const user = userEvent.setup()
    const a = store().addProfile({ name: 'Alpha' })
    store().addProfile({ name: 'Beta' })
    render(<ConnectionSidebar />)
    await user.click(screen.getByRole('button', { name: 'Alpha' }))
    expect(store().activeProfileId).toBe(a.id)
  })

  it('Rename updates the name on Enter', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'Alpha' })
    render(<ConnectionSidebar />)
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Profile name' })
    await user.clear(input)
    await user.type(input, 'Gamma{Enter}')
    expect(active().name).toBe('Gamma')
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeInTheDocument()
  })

  it('Duplicate adds "<name> (copy)" and selects it', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'Alpha' })
    render(<ConnectionSidebar />)
    await user.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(store().profiles.map((p) => p.name)).toEqual(['Alpha', 'Alpha (copy)'])
    expect(active().name).toBe('Alpha (copy)')
  })

  it('Delete asks for confirmation; cancel keeps the profile, confirm deletes it', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'Alpha' })
    render(<ConnectionSidebar />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(store().profiles).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog2 = await screen.findByRole('alertdialog')
    await user.click(within(dialog2).getByRole('button', { name: 'Delete' }))
    expect(store().profiles).toHaveLength(0)
  })
})

describe('connection fields', () => {
  it('validates the URL live: bad -> inline reason, good -> none', () => {
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    const url = screen.getByLabelText('Server URL')
    fireEvent.change(url, { target: { value: 'ftp://x.test' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/http/)
    expect(url).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(url, { target: { value: 'https://user:pw@x.test/' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/credentials/i)
    fireEvent.change(url, { target: { value: 'https://x.test/mcp' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(active().url).toBe('https://x.test/mcp')
  })

  it('transport select offers Auto / Streamable HTTP / Legacy SSE and writes the choice', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    const trigger = screen.getByRole('combobox', { name: 'Transport' })
    expect(trigger).toHaveTextContent('Auto')
    await user.click(trigger)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Auto', 'Streamable HTTP', 'Legacy SSE'])
    await user.click(screen.getByRole('option', { name: 'Legacy SSE' }))
    expect(active().transport).toBe('sse')
  })

  it('protocol version select = Auto + the SDK versions; pinning and returning to Auto works', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    await user.click(screen.getByRole('combobox', { name: 'Protocol version' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Auto',
      '2025-11-25',
      '2025-06-18',
      '2025-03-26',
      '2024-11-05',
      '2024-10-07',
    ])
    await user.click(screen.getByRole('option', { name: '2025-06-18' }))
    expect(active().protocolVersion).toBe('2025-06-18')
    await user.click(screen.getByRole('combobox', { name: 'Protocol version' }))
    await user.click(screen.getByRole('option', { name: 'Auto' }))
    expect(active().protocolVersion).toBeNull()
  })

  it('has a stdio help line that names bridging to HTTP and gives no command line', () => {
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    const help = screen.getByText(/stdio\?/)
    expect(help.textContent).toMatch(/cannot spawn stdio/i)
    expect(help.textContent).toMatch(/bridge/i)
    expect(help.textContent).not.toMatch(/npx|uvx|docker|mcp-proxy|supergateway/i)
  })
})

describe('header editor', () => {
  async function addHeader(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Add header/ }))
  }

  it('adds, edits, disables and removes a plain header', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    await addHeader(user)
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'X-Trace' } })
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'abc' } })
    expect(active().headers).toMatchObject([{ name: 'X-Trace', value: 'abc', secret: false, enabled: true }])
    expect(screen.getByLabelText('Header 1 value')).toHaveAttribute('type', 'text')

    await user.click(screen.getByLabelText('Header 1 enabled'))
    expect(active().headers[0].enabled).toBe(false)

    await user.click(screen.getByLabelText('Remove header 1'))
    expect(active().headers).toHaveLength(0)
  })

  it('defaults the secret flag from the typed name and uses a password input with a reveal toggle', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    await addHeader(user)
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Authorization' } })
    expect(active().headers[0].secret).toBe(true)
    expect(screen.getByLabelText('Header 1 secret')).toBeChecked()
    const value = screen.getByLabelText('Header 1 value')
    expect(value).toHaveAttribute('type', 'password')
    await user.click(screen.getByLabelText('Reveal header 1 value'))
    expect(screen.getByLabelText('Header 1 value')).toHaveAttribute('type', 'text')
    await user.click(screen.getByLabelText('Hide header 1 value'))
    expect(screen.getByLabelText('Header 1 value')).toHaveAttribute('type', 'password')
  })

  it('a non-secret name does not set the flag, and a manual toggle sticks while the name changes', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    await addHeader(user)
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'X-Trace' } })
    expect(active().headers[0].secret).toBe(false)
    await user.click(screen.getByLabelText('Header 1 secret'))
    expect(active().headers[0].secret).toBe(true)
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'X-Other' } })
    expect(active().headers[0].secret).toBe(true)
  })

  it('writes a typed secret via setSecret (session by default) and leaves the profile value empty', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    await addHeader(user)
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Authorization' } })
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'Bearer TOPSECRET' } })

    const h = active().headers[0]
    expect(h.value).toBe('')
    expect(getSecret(`hdr:${active().id}:${h.id}`)).toBe('Bearer TOPSECRET')
    expect(allLocalText()).not.toContain('TOPSECRET')
    expect(localStorage.getItem(STORE_KEY)).not.toContain('TOPSECRET')
    expect(sessionStorage.getItem(SESSION_SECRETS_KEY)).toContain('TOPSECRET')
    // the input still shows what the user typed
    expect(screen.getByLabelText('Header 1 value')).toHaveValue('Bearer TOPSECRET')
  })

  it('with persistSecrets the secret goes to localStorage secrets only, never the profile blob', async () => {
    const user = userEvent.setup()
    const p = store().addProfile({ name: 'A' })
    store().updateProfile(p.id, { persistSecrets: true })
    render(<ConnectionSidebar />)
    await addHeader(user)
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'X-Api-Key' } })
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'KEY123' } })
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toContain('KEY123')
    expect(localStorage.getItem(STORE_KEY)).not.toContain('KEY123')
    expect(active().headers[0].value).toBe('')
  })

  it('shows an inline error when the secret cannot be stored', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    await addHeader(user)
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Authorization' } })
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string) {
      if (key === SESSION_SECRETS_KEY) throw new DOMException('quota', 'QuotaExceededError')
    })
    try {
      fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'Bearer X' } })
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not store a secret/)
    } finally {
      spy.mockRestore()
    }
    // a later successful write clears the message
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'Bearer Y' } })
    expect(screen.queryByText(/Could not store a secret/)).toBeNull()
  })

  it('lists invalid header names and Fetch-forbidden warnings under the editor', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    await addHeader(user)
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Bad Name' } })
    expect(screen.getByText(/Invalid header name: Bad Name/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Host' } })
    expect(screen.queryByText(/Invalid header name/)).toBeNull()
    expect(within(screen.getByRole('list', { name: 'Header warnings' })).getByText(/Host.*ignored/)).toBeInTheDocument()
  })

  it('a secret keeps its secret flag when the name is edited after a value was typed', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    await addHeader(user)
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Authorization' } })
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'Bearer Z' } })
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'X-Custom' } })
    expect(active().headers[0].secret).toBe(true)
    expect(screen.getByLabelText('Header 1 value')).toHaveValue('Bearer Z')
  })
})

describe('persistSecrets', () => {
  it('is labelled with an unencrypted-storage warning', () => {
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    expect(screen.getByText(/stored unencrypted in this browser/i)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Remember secrets/ })).not.toBeChecked()
  })

  it('ticking persists immediately and moves existing session secrets to localStorage', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    await user.click(screen.getByRole('button', { name: /Add header/ }))
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Authorization' } })
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'Bearer MOVE' } })
    expect(allLocalText()).not.toContain('MOVE')
    await user.click(screen.getByRole('checkbox', { name: /Remember secrets/ }))
    expect(active().persistSecrets).toBe(true)
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toContain('MOVE')
  })

  it('unticking with secrets present asks first; Keep leaves everything, Delete removes the saved copies', async () => {
    const user = userEvent.setup()
    const p = store().addProfile({ name: 'A' })
    store().updateProfile(p.id, { persistSecrets: true })
    render(<ConnectionSidebar />)
    await user.click(screen.getByRole('button', { name: /Add header/ }))
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Authorization' } })
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'Bearer KEEP' } })
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toContain('KEEP')

    await user.click(screen.getByRole('checkbox', { name: /Remember secrets/ }))
    let dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/deleted from this browser/i)
    // nothing changed yet
    expect(active().persistSecrets).toBe(true)
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toContain('KEEP')
    await user.click(within(dialog).getByRole('button', { name: 'Keep remembering' }))
    expect(active().persistSecrets).toBe(true)
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY)).toContain('KEEP')

    await user.click(screen.getByRole('checkbox', { name: /Remember secrets/ }))
    dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete saved secrets' }))
    expect(active().persistSecrets).toBe(false)
    expect(localStorage.getItem(PERSISTED_SECRETS_KEY) ?? '').not.toContain('KEEP')
    // the value is still usable for this tab session, and the form still shows it
    expect(sessionStorage.getItem(SESSION_SECRETS_KEY)).toContain('KEEP')
    expect(getSecret(`hdr:${active().id}:${active().headers[0].id}`)).toBe('Bearer KEEP')
    expect(screen.getByLabelText('Header 1 value')).toHaveValue('Bearer KEEP')
  })

  it('unticking with no secrets needs no confirmation', async () => {
    const user = userEvent.setup()
    const p = store().addProfile({ name: 'A' })
    store().updateProfile(p.id, { persistSecrets: true })
    render(<ConnectionSidebar />)
    await user.click(screen.getByRole('checkbox', { name: /Remember secrets/ }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(active().persistSecrets).toBe(false)
  })

  it('shows an inline error when ticking cannot reach persistent storage', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    await user.click(screen.getByRole('button', { name: /Add header/ }))
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Authorization' } })
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'Bearer Q' } })
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string) {
      if (key === PERSISTED_SECRETS_KEY) throw new DOMException('quota', 'QuotaExceededError')
    })
    try {
      await user.click(screen.getByRole('checkbox', { name: /Remember secrets/ }))
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not store a secret/)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('export / import', () => {
  it('Export downloads mcp-inspector-profiles.json with secrets stripped', async () => {
    const user = userEvent.setup()
    store().addProfile({ name: 'A' })
    render(<ConnectionSidebar />)
    await user.click(screen.getByRole('button', { name: /Add header/ }))
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Authorization' } })
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'Bearer EXPORTME' } })
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(downloadBlob).toHaveBeenCalledTimes(1)
    const [filename, data, mime] = vi.mocked(downloadBlob).mock.calls[0]
    expect(filename).toBe('mcp-inspector-profiles.json')
    expect(mime).toBe('application/json')
    expect(String(data)).not.toContain('EXPORTME')
    expect(JSON.parse(String(data)).version).toBe(1)
  })

  function pickFile(text: string) {
    const input = screen.getByLabelText('Import profiles file') as HTMLInputElement
    const file = new File([text], 'p.json', { type: 'application/json' })
    // jsdom's File.text() exists in recent versions; make sure either way.
    if (typeof file.text !== 'function') Object.defineProperty(file, 'text', { value: async () => text })
    fireEvent.change(input, { target: { files: [file] } })
  }

  it('Import shows "Imported N, skipped M" and adds the profiles without changing the selection', async () => {
    const keep = store().addProfile({ name: 'Existing' })
    render(<ConnectionSidebar />)
    pickFile(
      JSON.stringify({
        version: 1,
        profiles: [
          { name: 'Imp 1', url: 'https://a.test/mcp', headers: [{ name: 'X-A', value: 'v' }] },
          { name: 'Imp 2', url: 'https://b.test/mcp', transport: 'sse' },
          { name: 5 },
        ],
      }),
    )
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Imported 2, skipped 1'))
    expect(store().profiles.map((p) => p.name)).toEqual(['Existing', 'Imp 1', 'Imp 2'])
    expect(store().profiles[1].url).toBe('https://a.test/mcp')
    expect(store().profiles[1].headers).toMatchObject([{ name: 'X-A', value: 'v' }])
    expect(store().profiles[2].transport).toBe('sse')
    expect(store().activeProfileId).toBe(keep.id)
  })

  it('Import shows the error for a bad file', async () => {
    render(<ConnectionSidebar />)
    pickFile('not json')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Invalid JSON/))
    expect(store().profiles).toHaveLength(0)
  })
})
