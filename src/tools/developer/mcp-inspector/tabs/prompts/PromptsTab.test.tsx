import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONRPCMessage } from '@modelcontextprotocol/client'
import { createSession, type McpSession } from '../../connection/session'
import type { ServerSummary } from '../../connection/types'
import { createFakeServer, type FakeServer, type FakeServerOptions } from '../../testing/fakeServer'
import { useMcpInspectorStore } from '../../store'
import PromptsTab from './PromptsTab'

const CAPS = { prompts: { listChanged: true } }

interface Setup {
  fake: FakeServer
  session: McpSession
  info: ServerSummary
}

const opened: Setup[] = []

async function setup(options: FakeServerOptions = {}, capabilities: Record<string, unknown> = CAPS): Promise<Setup> {
  const fake = createFakeServer({ capabilities, ...options })
  const session = createSession({
    config: { url: 'https://mcp.test/mcp', transport: 'streamable-http', headers: [], protocolVersion: null },
    onLog: () => undefined,
    onState: () => undefined,
    transportFactory: () => fake.clientTransport,
  })
  const state = await session.connect()
  if (state.status !== 'connected') throw new Error(`connect failed: ${state.status}`)
  const s = { fake, session, info: state.info }
  opened.push(s)
  return s
}

function mount(s: Setup) {
  return render(
    <PromptsTab
      session={s.session}
      info={s.info}
      sessionOptions={{ config: { url: 'https://mcp.test/mcp', transport: 'auto', headers: [], protocolVersion: null } }}
      profileId="p1"
    />,
  )
}

const methods = (fake: FakeServer, method: string) =>
  fake.received.filter((m): m is JSONRPCMessage & { method: string; params?: Record<string, unknown> } => (m as { method?: string }).method === method)

const review = {
  name: 'review',
  description: 'Review code',
  arguments: [
    { name: 'code', description: 'Code to review', required: true },
    { name: 'tone', description: 'Tone' },
  ],
}

const reviewHandler = (args: Record<string, string>) => ({
  description: 'A review',
  messages: [
    { role: 'user', content: { type: 'text', text: `Please review: ${args.code}` } },
    { role: 'assistant', content: { type: 'text', text: 'Looks <b>good</b>' } },
  ],
})

beforeEach(() => {
  useMcpInspectorStore.setState({ history: [], prefs: { saveHistory: true } })
})

afterEach(async () => {
  cleanup()
  for (const s of opened.splice(0)) {
    await s.session.disconnect()
    await s.fake.close()
  }
})

describe('PromptsTab list', () => {
  it('merges pages and shows name and description', async () => {
    const s = await setup({
      prompts: [review, { name: 'p2', description: 'second' }, { name: 'p3', title: 'Third' }],
      pageSize: 2,
    })
    mount(s)
    expect(await screen.findByText('review')).toBeInTheDocument()
    expect(screen.getByText('p2')).toBeInTheDocument()
    expect(screen.getByText('Third')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
    expect(methods(s.fake, 'prompts/list')).toHaveLength(2)
  })

  it('searches by name', async () => {
    const s = await setup({ prompts: [review, { name: 'translate' }] })
    mount(s)
    await screen.findByText('review')
    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search prompts' }), 'trans')
    expect(screen.queryByText('review')).toBeNull()
    expect(screen.getByText('translate')).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    const s = await setup({ prompts: [] })
    mount(s)
    expect(await screen.findByText('No prompts.')).toBeInTheDocument()
  })

  it('shows the error with Retry and recovers', async () => {
    let fail = true
    const s = await setup({
      prompts: [review],
      onRequest: ({ method }) => (method === 'prompts/list' && fail ? { error: { code: -32603, message: 'kaput' } } : undefined),
    })
    mount(s)
    expect(await screen.findByText('kaput')).toBeInTheDocument()
    fail = false
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('review')).toBeInTheDocument()
    expect(screen.queryByText('kaput')).toBeNull()
  })

  it('refreshes on prompts/list_changed', async () => {
    const items = [review]
    const s = await setup({ prompts: items })
    mount(s)
    await screen.findByText('review')
    items.push({ name: 'fresh' } as typeof review)
    await act(async () => {
      await s.fake.sendNotification('notifications/prompts/list_changed')
    })
    expect(await screen.findByText('fresh')).toBeInTheDocument()
  })
})

describe('PromptsTab get', () => {
  it('blocks a request with a missing required argument and sends no prompts/get', async () => {
    const s = await setup({ prompts: [review], promptHandlers: { review: reviewHandler } })
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /review/ }))
    await user.click(screen.getByRole('button', { name: 'Get prompt' }))
    expect(await screen.findByText('Required')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 30))
    expect(methods(s.fake, 'prompts/get')).toHaveLength(0)
    expect(useMcpInspectorStore.getState().history).toHaveLength(0)
  })

  it('renders messages with role badges, passes string arguments and pushes history', async () => {
    const s = await setup({ prompts: [review], promptHandlers: { review: reviewHandler } })
    const { container } = mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /review/ }))
    await user.type(screen.getByRole('textbox', { name: /code/ }), 'x=1')
    await user.click(screen.getByRole('button', { name: 'Get prompt' }))

    const messages = await screen.findAllByTestId('prompt-message')
    expect(messages).toHaveLength(2)
    expect(within(messages[0]).getByText('user')).toBeInTheDocument()
    expect(within(messages[0]).getByText('Please review: x=1')).toBeInTheDocument()
    expect(within(messages[1]).getByText('assistant')).toBeInTheDocument()
    // server text is text, never HTML
    expect(within(messages[1]).getByText('Looks <b>good</b>')).toBeInTheDocument()
    expect(container.querySelector('b')).toBeNull()

    expect(methods(s.fake, 'prompts/get')[0].params).toEqual({ name: 'review', arguments: { code: 'x=1' } })
    expect(useMcpInspectorStore.getState().history[0]).toMatchObject({ kind: 'prompt', name: 'review', ok: true, profileId: 'p1' })
  })

  it('shows a JSON-RPC error as "Protocol error"', async () => {
    const s = await setup({ prompts: [{ name: 'ghost' }], promptHandlers: {} })
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /ghost/ }))
    await user.click(screen.getByRole('button', { name: 'Get prompt' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Protocol error')
    expect(alert).toHaveTextContent('Code -32602')
    expect(alert).toHaveTextContent('Unknown prompt: ghost')
    expect(useMcpInspectorStore.getState().history[0]).toMatchObject({ kind: 'prompt', ok: false })
  })

  it('a prompt without arguments can be fetched directly', async () => {
    const s = await setup({
      prompts: [{ name: 'plain' }],
      promptHandlers: { plain: () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }] }) },
    })
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /plain/ }))
    expect(screen.getByText('This prompt takes no arguments.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Get prompt' }))
    expect(await screen.findByText('hello')).toBeInTheDocument()
    expect(methods(s.fake, 'prompts/get')[0].params).toEqual({ name: 'plain', arguments: {} })
  })
})

describe('PromptsTab completions', () => {
  it('requests completions (debounced) with a ref/prompt when completions is advertised', async () => {
    const s = await setup(
      {
        prompts: [review],
        onRequest: ({ method }) =>
          method === 'completion/complete' ? { result: { completion: { values: ['formal', 'casual'] } } } : undefined,
      },
      { ...CAPS, completions: {} },
    )
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /review/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Include tone' }))
    await user.type(screen.getByRole('textbox', { name: /tone/ }), 'fo')
    expect(methods(s.fake, 'completion/complete')).toHaveLength(0) // debounced
    const list = await screen.findByRole('list', { name: 'Suggestions for tone' })
    const calls = methods(s.fake, 'completion/complete')
    expect(calls).toHaveLength(1)
    expect(calls[0].params).toMatchObject({ ref: { type: 'ref/prompt', name: 'review' }, argument: { name: 'tone', value: 'fo' } })
    await user.click(within(list).getByRole('button', { name: 'casual' }))
    expect(screen.getByRole('textbox', { name: /tone/ })).toHaveValue('casual')
  })

  it('sends no completion request without the completions capability', async () => {
    const s = await setup({ prompts: [review] })
    mount(s)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /review/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Include tone' }))
    await user.type(screen.getByRole('textbox', { name: /tone/ }), 'fo')
    await new Promise((r) => setTimeout(r, 450))
    expect(methods(s.fake, 'completion/complete')).toHaveLength(0)
  })
})
