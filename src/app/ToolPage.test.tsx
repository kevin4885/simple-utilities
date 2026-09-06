/**
 * ToolPage — legacy-id redirect and NotFound fallback.
 *
 * Verifies that visiting a legacy tool id (`LEGACY_TOOL_IDS`) redirects to the
 * current tool route, while a genuinely unknown id still renders NotFoundPage.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { ToolPage } from './ToolPage'

describe('ToolPage', () => {
  it('redirects a legacy tool id to its current id', async () => {
    render(
      <MemoryRouter initialEntries={['/tools/visual-markdown-editor']}>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/tools/markdown-editor" element={<div>redirected</div>} />
            <Route path="/tools/:id" element={<ToolPage />} />
          </Routes>
        </Suspense>
      </MemoryRouter>,
    )

    expect(await screen.findByText('redirected')).toBeInTheDocument()
  })

  it('renders NotFoundPage for an id that is neither a tool nor a legacy id', async () => {
    render(
      <MemoryRouter initialEntries={['/tools/does-not-exist']}>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/tools/markdown-editor" element={<div>redirected</div>} />
            <Route path="/tools/:id" element={<ToolPage />} />
          </Routes>
        </Suspense>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Page not found')).toBeInTheDocument()
  })
})
