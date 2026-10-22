import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./viewerIo', async (orig) => ({
  ...(await orig<typeof import('./viewerIo')>()),
  copyText: vi.fn().mockResolvedValue(true),
  downloadBlob: vi.fn(),
}))

import { copyText, downloadBlob } from './viewerIo'
import { ContentView } from './ContentView'

const B64 = 'aGVsbG8=' // "hello", 5 bytes

beforeEach(() => {
  vi.mocked(copyText).mockClear()
  vi.mocked(downloadBlob).mockClear()
})

describe('ContentView blocks', () => {
  it('renders script text literally and creates no script element', () => {
    const { container } = render(<ContentView blocks={[{ type: 'text', text: '<script>alert(1)</script>' }]} />)
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders HTML in text as text (no img element)', () => {
    const { container } = render(<ContentView blocks={[{ type: 'text', text: '<img src=x onerror=alert(1)>' }]} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])('renders %s as a data: URL image', (mime) => {
    const { container } = render(<ContentView blocks={[{ type: 'image', mimeType: mime, data: B64 }]} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe(`data:${mime};base64,${B64}`)
  })

  it.each(['image/svg+xml', 'image/x-unknown'])('does not render %s inline and shows mime + size', (mime) => {
    const { container } = render(<ContentView blocks={[{ type: 'image', mimeType: mime, data: B64 }]} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Unsupported image type')).toBeInTheDocument()
    expect(container.textContent).toContain(mime)
    expect(container.textContent).toContain('5 B')
  })

  it('does not render an image whose data is not valid base64 (cannot smuggle into the data: URL)', () => {
    const { container } = render(
      <ContentView blocks={[{ type: 'image', mimeType: 'image/png', data: 'x" onerror="alert(1)' }]} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Invalid image data')).toBeInTheDocument()
  })

  it('does not trust a mime type with injected characters', () => {
    const { container } = render(
      <ContentView blocks={[{ type: 'image', mimeType: 'image/png;base64,AAAA#', data: B64 }]} />,
    )
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders audio with controls and a data: src', () => {
    const { container } = render(<ContentView blocks={[{ type: 'audio', mimeType: 'audio/wav', data: B64 }]} />)
    const audio = container.querySelector('audio')
    expect(audio).not.toBeNull()
    expect(audio!.hasAttribute('controls')).toBe(true)
    expect(audio!.getAttribute('src')).toBe(`data:audio/wav;base64,${B64}`)
  })

  it('does not render audio with a non-audio mime type', () => {
    const { container } = render(<ContentView blocks={[{ type: 'audio', mimeType: 'text/html', data: B64 }]} />)
    expect(container.querySelector('audio')).toBeNull()
  })

  it('renders resource_link as text with a Copy URI button and no anchor', async () => {
    const { container } = render(
      <ContentView
        blocks={[
          { type: 'resource_link', uri: 'https://x.test/a?b=1', name: 'thing', description: 'A <b>thing</b>' },
        ]}
      />,
    )
    expect(container.textContent).toContain('https://x.test/a?b=1')
    expect(container.textContent).toContain('thing')
    expect(container.textContent).toContain('A <b>thing</b>')
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('[href]')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Copy URI' }))
    expect(copyText).toHaveBeenCalledWith('https://x.test/a?b=1')
  })

  it('renders an embedded text resource with its uri and mime', () => {
    const { container } = render(
      <ContentView
        blocks={[{ type: 'resource', resource: { uri: 'file:///a.txt', mimeType: 'text/plain', text: 'body text' } }]}
      />,
    )
    expect(container.textContent).toContain('file:///a.txt')
    expect(container.textContent).toContain('text/plain')
    expect(screen.getByText('body text')).toBeInTheDocument()
  })

  it('renders an embedded blob resource with size, mime and a Download button that only acts on click', async () => {
    render(
      <ContentView
        blocks={[{ type: 'resource', resource: { uri: 'file:///dir/a.bin', mimeType: 'application/pdf', blob: B64 } }]}
      />,
    )
    expect(screen.getByText(/file:\/\/\/dir\/a\.bin · application\/pdf/)).toBeInTheDocument()
    expect(screen.getByText(/5 B/)).toBeInTheDocument()
    expect(downloadBlob).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(downloadBlob).toHaveBeenCalledTimes(1)
    const [name, , type] = vi.mocked(downloadBlob).mock.calls[0]
    expect(name).toBe('a.bin')
    expect(type).toBe('application/pdf')
  })

  it('falls back to JsonView for an unknown block type', () => {
    const { container } = render(<ContentView blocks={[{ type: 'hologram', payload: 1 }]} />)
    expect(container.querySelector('pre')!.textContent).toBe(JSON.stringify({ type: 'hologram', payload: 1 }, null, 2))
  })

  it('falls back to JsonView for non-object blocks and shows an empty state', () => {
    const { container, rerender } = render(<ContentView blocks={['raw string']} />)
    expect(container.textContent).toContain('raw string')
    rerender(<ContentView blocks={[]} />)
    expect(screen.getByText('No content.')).toBeInTheDocument()
  })
})

describe('ContentView resourceContents', () => {
  it('renders each entry like embedded resources', async () => {
    const { container } = render(
      <ContentView
        resourceContents={[
          { uri: 'file:///a.txt', mimeType: 'text/plain', text: '<script>x</script>' },
          { uri: 'file:///b.bin', mimeType: 'image/png', blob: B64 },
        ]}
      />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<script>x</script>')
    expect(container.textContent).toContain('file:///b.bin')
    expect(downloadBlob).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(downloadBlob).toHaveBeenCalledTimes(1)
  })
})
