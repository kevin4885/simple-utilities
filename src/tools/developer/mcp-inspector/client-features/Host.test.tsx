import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ClientFeatureHost from './Host'
import { useClientPending } from './pendingStore'

beforeEach(() => {
  useClientPending.getState().reset()
})
afterEach(() => {
  vi.restoreAllMocks()
})

interface Outcome {
  resolved: unknown[]
  rejected: unknown[]
}

/** Queues a request the way the SDK handler does and records how it settles. */
function enqueue(kind: 'sampling' | 'elicitation', params: unknown, ctxId = 1): Outcome {
  const out: Outcome = { resolved: [], rejected: [] }
  act(() => {
    void useClientPending
      .getState()
      .enqueue({ ctxId, kind, params })
      .then(
        (r) => out.resolved.push(r),
        (e) => out.rejected.push(e),
      )
  })
  return out
}
const settle = () => act(async () => { await Promise.resolve() })

const SAMPLING = {
  systemPrompt: 'You are terse.',
  maxTokens: 123,
  modelPreferences: { hints: [{ name: 'claude-x' }], speedPriority: 0.5 },
  messages: [
    { role: 'user', content: { type: 'text', text: 'What is 2+2?' } },
    { role: 'assistant', content: { type: 'text', text: 'Let me think.' } },
  ],
}

describe('ClientFeatureHost', () => {
  it('renders nothing without a pending request', () => {
    const { container } = render(<ClientFeatureHost />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  describe('sampling', () => {
    it('shows system prompt, each message with its role, max tokens and model preferences as read-only text', () => {
      enqueue('sampling', SAMPLING)
      render(<ClientFeatureHost />)
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText('You are terse.')).toBeInTheDocument()
      const messages = within(dialog).getAllByTestId('sampling-message')
      expect(messages).toHaveLength(2)
      expect(within(messages[0]).getByText('user')).toBeInTheDocument()
      expect(within(messages[0]).getByText('What is 2+2?')).toBeInTheDocument()
      expect(within(messages[1]).getByText('assistant')).toBeInTheDocument()
      expect(within(dialog).getByText(/Max tokens: 123/)).toBeInTheDocument()
      expect(within(dialog).getByText(/claude-x/)).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Model name')).toHaveValue('manual')
      expect(within(dialog).getByLabelText('Stop reason')).toHaveValue('endTurn')
    })

    it('Approve answers the typed reply with the chosen model and stop reason', async () => {
      const out = enqueue('sampling', SAMPLING)
      render(<ClientFeatureHost />)
      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Reply text'), 'Four')
      await user.clear(screen.getByLabelText('Model name'))
      await user.type(screen.getByLabelText('Model name'), 'human-1')
      await user.click(screen.getByRole('button', { name: 'Approve' }))
      await settle()
      expect(out.resolved).toEqual([
        { role: 'assistant', content: { type: 'text', text: 'Four' }, model: 'human-1', stopReason: 'endTurn' },
      ])
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('Reject answers JSON-RPC error code -1 "User rejected sampling request"', async () => {
      const out = enqueue('sampling', SAMPLING)
      render(<ClientFeatureHost />)
      await userEvent.setup().click(screen.getByRole('button', { name: 'Reject' }))
      await settle()
      expect(out.resolved).toEqual([])
      expect(out.rejected).toHaveLength(1)
      expect(out.rejected[0]).toMatchObject({ code: -1, message: 'User rejected sampling request' })
    })

    it('a pointer-down outside the dialog leaves the request pending', async () => {
      const out = enqueue('sampling', SAMPLING)
      render(<ClientFeatureHost />)
      // Radix registers its outside-interaction listener on a deferred tick.
      await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
      fireEvent.pointerDown(document.body)
      fireEvent.pointerUp(document.body)
      fireEvent.click(document.body)
      await settle()
      expect(out.rejected).toEqual([])
      expect(out.resolved).toEqual([])
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(useClientPending.getState().pending).toHaveLength(1)
    })

    it('Escape (closing the dialog) rejects the request', async () => {
      const out = enqueue('sampling', SAMPLING)
      render(<ClientFeatureHost />)
      await userEvent.setup().keyboard('{Escape}')
      await settle()
      expect(out.rejected[0]).toMatchObject({ code: -1 })
    })

    it('stays pending until the user acts', async () => {
      const out = enqueue('sampling', SAMPLING)
      render(<ClientFeatureHost />)
      await new Promise((r) => setTimeout(r, 30))
      expect(out.resolved).toEqual([])
      expect(out.rejected).toEqual([])
      expect(useClientPending.getState().pending).toHaveLength(1)
    })

    it('renders hostile server text as text: no img / script / link elements are created (acceptance 9)', () => {
      const hostile = '<img src=x onerror=alert(1)>'
      enqueue('sampling', {
        systemPrompt: `${hostile}<script>alert(2)</script>`,
        messages: [{ role: 'user', content: { type: 'text', text: hostile } }],
        modelPreferences: { hints: [{ name: hostile }] },
      })
      render(<ClientFeatureHost />)
      const dialog = screen.getByRole('dialog')
      expect(dialog.querySelector('img')).toBeNull()
      expect(dialog.querySelector('script')).toBeNull()
      expect(document.querySelector('img')).toBeNull()
      expect(within(dialog).getAllByText(new RegExp(hostile.replace(/[()]/g, '\\$&'))).length).toBeGreaterThan(0)
    })
  })

  describe('elicitation (form)', () => {
    const SCHEMA = {
      type: 'object',
      properties: { name: { type: 'string', title: 'Your name' }, age: { type: 'integer', title: 'Age' } },
      required: ['name', 'age'],
    }

    it('shows the server message as text and renders the schema form', () => {
      enqueue('elicitation', { message: 'Who are you? <b>bold</b>', requestedSchema: SCHEMA })
      render(<ClientFeatureHost />)
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByTestId('elicit-message')).toHaveTextContent('Who are you? <b>bold</b>')
      expect(dialog.querySelector('b')).toBeNull()
      expect(within(dialog).getByLabelText(/Your name/)).toBeInTheDocument()
    })

    it('Accept with an invalid form is blocked and sends no response', async () => {
      const out = enqueue('elicitation', { message: 'm', requestedSchema: SCHEMA })
      render(<ClientFeatureHost />)
      await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }))
      await settle()
      expect(out.resolved).toEqual([])
      expect(out.rejected).toEqual([])
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(useClientPending.getState().pending).toHaveLength(1)
      expect(screen.getByText('Required')).toBeInTheDocument()
    })

    it('Accept with valid input answers {action:accept, content}', async () => {
      const out = enqueue('elicitation', { message: 'm', requestedSchema: SCHEMA })
      render(<ClientFeatureHost />)
      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/Age/), '36')
      await user.type(screen.getByLabelText(/Your name/), 'Ada')
      await user.click(screen.getByRole('button', { name: 'Accept' }))
      await settle()
      expect(out.resolved).toEqual([{ action: 'accept', content: { age: 36, name: 'Ada' } }])
    })

    it('Decline and Cancel answer without content', async () => {
      const declined = enqueue('elicitation', { message: 'm', requestedSchema: SCHEMA })
      const { unmount } = render(<ClientFeatureHost />)
      await userEvent.setup().click(screen.getByRole('button', { name: 'Decline' }))
      await settle()
      expect(declined.resolved).toEqual([{ action: 'decline' }])
      unmount()

      const cancelled = enqueue('elicitation', { message: 'm', requestedSchema: SCHEMA })
      render(<ClientFeatureHost />)
      await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }))
      await settle()
      expect(cancelled.resolved).toEqual([{ action: 'cancel' }])
    })

    it('closing the dialog (Escape) answers {action:cancel}', async () => {
      const out = enqueue('elicitation', { message: 'm', requestedSchema: SCHEMA })
      render(<ClientFeatureHost />)
      await userEvent.setup().keyboard('{Escape}')
      await settle()
      expect(out.resolved).toEqual([{ action: 'cancel' }])
    })

    it('a schema the form cannot render falls back to a raw JSON editor', async () => {
      const out = enqueue('elicitation', { message: 'm', requestedSchema: { $ref: '#/$defs/x' } })
      render(<ClientFeatureHost />)
      const editor = screen.getByLabelText('Response JSON')
      fireEvent.change(editor, { target: { value: '{ nope' } })
      await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }))
      expect(screen.getByRole('alert')).toHaveTextContent(/Invalid JSON/)
      expect(out.resolved).toEqual([])

      fireEvent.change(editor, { target: { value: '{"a":"x","n":2}' } })
      await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }))
      await settle()
      expect(out.resolved).toEqual([{ action: 'accept', content: { a: 'x', n: 2 } }])
    })

    it('raw JSON values that are not allowed in an elicitation answer are blocked', async () => {
      const out = enqueue('elicitation', { message: 'm', requestedSchema: { $ref: '#/x' } })
      render(<ClientFeatureHost />)
      fireEvent.change(screen.getByLabelText('Response JSON'), { target: { value: '{"a":{"deep":1}}' } })
      await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }))
      expect(screen.getByRole('alert')).toHaveTextContent(/"a" must be/)
      expect(out.resolved).toEqual([])
    })
  })

  describe('elicitation (URL mode)', () => {
    const URL_REQ = (url: string) => ({ mode: 'url', message: 'Please sign in', url, elicitationId: 'e1' })

    it('shows the message, the FULL url and its host prominently; nothing opens on render', () => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null)
      enqueue('elicitation', URL_REQ('https://login.example.test:8443/a/b?token=abc#frag'))
      render(<ClientFeatureHost />)
      expect(screen.getByTestId('elicit-message')).toHaveTextContent('Please sign in')
      expect(screen.getByTestId('elicit-url')).toHaveTextContent('https://login.example.test:8443/a/b?token=abc#frag')
      expect(screen.getByTestId('elicit-host')).toHaveTextContent('login.example.test:8443')
      expect(screen.getByRole('button', { name: 'Open link' })).toBeEnabled()
      expect(open).not.toHaveBeenCalled()
      expect(document.querySelector('a[href]')).toBeNull()
    })

    it('Open link opens the normalised URL (the one the host above was read from) only on click, with noopener,noreferrer', async () => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null)
      enqueue('elicitation', URL_REQ('HTTPS://Login.Example.TEST:443/x'))
      render(<ClientFeatureHost />)
      await userEvent.setup().click(screen.getByRole('button', { name: 'Open link' }))
      expect(open).toHaveBeenCalledTimes(1)
      expect(open).toHaveBeenCalledWith('https://login.example.test/x', '_blank', 'noopener,noreferrer')
    })

    it.each(['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://x.test/a', 'not a url'])(
      'refuses %s: shows a refusal message and Open link is disabled',
      async (url) => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null)
        enqueue('elicitation', URL_REQ(url))
        render(<ClientFeatureHost />)
        expect(screen.getByTestId('elicit-refusal')).toHaveTextContent(/Refused/)
        const button = screen.getByRole('button', { name: 'Open link' })
        expect(button).toBeDisabled()
        fireEvent.click(button)
        expect(open).not.toHaveBeenCalled()
        expect(screen.getByTestId('elicit-url')).toHaveTextContent(url)
      },
    )

    it('shows the real host of a deceptive url', () => {
      enqueue('elicitation', URL_REQ('https://accounts.google.com@evil.test/login'))
      render(<ClientFeatureHost />)
      expect(screen.getByTestId('elicit-host')).toHaveTextContent(/^evil\.test$/)
      expect(screen.getByText(/embedded credentials/)).toBeInTheDocument()
    })

    it('"I\'ve completed it" answers accept; Decline and Cancel answer decline / cancel', async () => {
      const done = enqueue('elicitation', URL_REQ('https://x.test/'))
      const first = render(<ClientFeatureHost />)
      await userEvent.setup().click(screen.getByRole('button', { name: "I've completed it" }))
      await settle()
      expect(done.resolved).toEqual([{ action: 'accept' }])
      first.unmount()

      for (const [label, action] of [['Decline', 'decline'], ['Cancel', 'cancel']] as const) {
        const out = enqueue('elicitation', URL_REQ('https://x.test/'))
        const r = render(<ClientFeatureHost />)
        await userEvent.setup().click(screen.getByRole('button', { name: label }))
        await settle()
        expect(out.resolved).toEqual([{ action }])
        r.unmount()
      }
    })
  })

  describe('queue', () => {
    it('shows requests FIFO with "n more waiting"', async () => {
      const first = enqueue('sampling', { ...SAMPLING, systemPrompt: 'FIRST' })
      enqueue('elicitation', { message: 'SECOND', requestedSchema: { type: 'object', properties: {} } })
      enqueue('sampling', { ...SAMPLING, systemPrompt: 'THIRD' })
      render(<ClientFeatureHost />)
      expect(screen.getByText('FIRST')).toBeInTheDocument()
      expect(screen.getByText('2 more waiting')).toBeInTheDocument()

      await userEvent.setup().click(screen.getByRole('button', { name: 'Approve' }))
      await settle()
      expect(first.resolved).toHaveLength(1)
      expect(screen.getByText('SECOND')).toBeInTheDocument()
      expect(screen.getByText('1 more waiting')).toBeInTheDocument()
      expect(screen.queryByText('FIRST')).toBeNull()
    })

    it('shows no waiting hint when the queue holds one request', () => {
      enqueue('sampling', SAMPLING)
      render(<ClientFeatureHost />)
      expect(screen.queryByText(/more waiting/)).toBeNull()
    })

    it('a dialog of a request that is rejected elsewhere (disconnect) disappears', async () => {
      const out = enqueue('sampling', SAMPLING, 7)
      render(<ClientFeatureHost />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      act(() => useClientPending.getState().disposeContext(7, new Error('gone')))
      await settle()
      expect(out.rejected).toHaveLength(1)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
