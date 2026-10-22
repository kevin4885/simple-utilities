import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ToolPage } from '@/app/ToolPage'
import { getToolById, tools } from '@/tools/registry'
import { useMcpInspectorStore } from './store'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  useMcpInspectorStore.setState({ profiles: [], activeProfileId: null, history: [] })
})

describe('registry entry', () => {
  it('resolves via getToolById with the planned metadata', () => {
    const tool = getToolById('mcp-inspector')
    expect(tool).toBeDefined()
    expect(tool).toMatchObject({ id: 'mcp-inspector', category: 'Developer', title: 'MCP Inspector' })
    for (const k of ['mcp', 'model context protocol', 'json-rpc', 'inspector', 'tools', 'sse', 'streamable http', 'oauth']) {
      expect(tool!.keywords).toContain(k)
    }
  })

  it('has a two-sentence description', () => {
    const sentences = getToolById('mcp-inspector')!.description.split(/(?<=[.!?])\s+/).filter(Boolean)
    expect(sentences).toHaveLength(2)
  })

  it('sits after the last other Developer tool and before the first Time tool', () => {
    const i = tools.findIndex((t) => t.id === 'mcp-inspector')
    expect(i).toBeGreaterThan(0)
    expect(tools[i - 1].category).toBe('Developer')
    expect(tools[i + 1].category).toBe('Time')
    expect(tools.filter((t) => t.id === 'mcp-inspector')).toHaveLength(1)
  })
})

describe('/tools/mcp-inspector route', () => {
  it('renders the shell inside the tool page', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/tools/mcp-inspector']}>
        <Routes>
          <Route path="/tools/:id" element={<ToolPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByLabelText('Message log')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
    expect(container.querySelector('.flex.flex-col.h-full.overflow-hidden')).not.toBeNull()
  })
})