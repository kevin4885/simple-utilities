import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import VersionDiff from './VersionDiff'
import { MAX_DIFF_D } from '@/tools/developer/diff-viewer/logic'

describe('VersionDiff', () => {
  it('identical content → "Identical to current document", zero diff rows', () => {
    const { container } = render(<VersionDiff versionContent={'a\nb'} currentContent={'a\nb'} />)
    expect(screen.getByText('Identical to current document')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-testid="diff-row"]').length).toBe(0)
  })

  it("'a\\nb' vs 'a\\nc' → header +1 -1, insert/delete rows, <mark> present", () => {
    const { container } = render(<VersionDiff versionContent={'a\nb'} currentContent={'a\nc'} />)
    expect(screen.getByText(/Changes since this version/)).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('\u22121')).toBeInTheDocument()
    const rows = container.querySelectorAll('[data-testid="diff-row"]')
    const types = Array.from(rows).map((r) => r.getAttribute('data-type'))
    expect(types).toContain('insert')
    expect(types).toContain('delete')
    expect(container.querySelector('mark')).not.toBeNull()
  })

  it("version 'a' vs current 'a\\nb' → one insert row containing 'b'", () => {
    const { container } = render(<VersionDiff versionContent="a" currentContent={'a\nb'} />)
    const rows = container.querySelectorAll('[data-testid="diff-row"]')
    const insertRows = Array.from(rows).filter((r) => r.getAttribute('data-type') === 'insert')
    expect(insertRows.length).toBe(1)
    expect(insertRows[0].textContent).toContain('b')
  })

  it('huge input (> 20,000 lines) → role=alert with the error text', () => {
    const huge = Array.from({ length: 20_001 }, (_, i) => `line ${i}`).join('\n')
    render(<VersionDiff versionContent={huge} currentContent="a" />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/too large/i)
  })

  it('no element has an inline style attribute containing "color"', () => {
    const { container } = render(<VersionDiff versionContent={'a\nb'} currentContent={'a\nc'} />)
    expect(container.querySelectorAll('[style*="color"]').length).toBe(0)
  })

  it('edit distance exceeding MAX_DIFF_D → fallback note shown', () => {
    const lines = MAX_DIFF_D + 500
    const versionContent = Array.from({ length: lines }, (_, i) => `v-${i}`).join('\n')
    const currentContent = Array.from({ length: lines }, (_, i) => `c-${i}`).join('\n')
    render(<VersionDiff versionContent={versionContent} currentContent={currentContent} />)
    expect(screen.getByText(/Large change — showing simplified diff/)).toBeInTheDocument()
  })
})
