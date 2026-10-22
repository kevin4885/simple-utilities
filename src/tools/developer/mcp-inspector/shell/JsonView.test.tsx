import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./viewerIo', async (orig) => ({ ...(await orig<typeof import('./viewerIo')>()), copyText: vi.fn().mockResolvedValue(true) }))

import { copyText } from './viewerIo'
import { JSON_VIEW_MAX_CHARS, JsonView, valueToText } from './JsonView'

beforeEach(() => vi.mocked(copyText).mockClear())

describe('valueToText', () => {
  it('handles undefined, strings, objects and unserialisable values', () => {
    expect(valueToText(undefined)).toBe('—')
    expect(valueToText('hi')).toBe('hi')
    expect(valueToText({ a: 1 })).toBe('{\n  "a": 1\n}')
    const circ: Record<string, unknown> = {}
    circ.self = circ
    expect(() => valueToText(circ)).not.toThrow()
  })
})

describe('JsonView', () => {
  it('renders objects as 2-space pretty JSON', () => {
    const { container } = render(<JsonView value={{ a: 1, b: [true] }} />)
    expect(container.querySelector('pre')!.textContent).toBe(JSON.stringify({ a: 1, b: [true] }, null, 2))
  })

  it('renders a string value as-is', () => {
    render(<JsonView value="hello world" />)
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('renders undefined as an em dash', () => {
    render(<JsonView value={undefined} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders HTML in values as text, not elements', () => {
    const { container } = render(<JsonView value="<img src=x onerror=alert(1)>" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('is read-only (no editable textbox) and shows no truncation notice for small values', () => {
    render(<JsonView value={{ a: 1 }} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText(/truncated/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy full' })).toBeNull()
  })

  it('truncates values over 200000 chars, shows a notice, and copies the full text', async () => {
    const big = 'x'.repeat(JSON_VIEW_MAX_CHARS + 500)
    const { container } = render(<JsonView value={big} />)
    expect(container.querySelector('pre')!.textContent).toHaveLength(JSON_VIEW_MAX_CHARS)
    expect(screen.getByText(/truncated/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copy full' }))
    expect(copyText).toHaveBeenCalledTimes(1)
    expect(copyText).toHaveBeenCalledWith(big)
  })

  it('does not truncate a value of exactly the limit', () => {
    render(<JsonView value={'y'.repeat(JSON_VIEW_MAX_CHARS)} />)
    expect(screen.queryByText(/truncated/i)).toBeNull()
  })
})
