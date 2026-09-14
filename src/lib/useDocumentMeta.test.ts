/**
 * src/lib/useDocumentMeta.test.ts
 *
 * Tests for the document title / meta-description side-effect hook.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDocumentMeta } from './useDocumentMeta'

function getDescriptionMetaTags(): NodeListOf<HTMLMetaElement> {
  return document.querySelectorAll<HTMLMetaElement>('meta[name="description"]')
}

describe('useDocumentMeta', () => {
  afterEach(() => {
    // Clean up any meta tags created during a test so tests don't leak state.
    getDescriptionMetaTags().forEach((el) => el.remove())
    document.title = ''
  })

  it('sets document.title and creates a meta description tag when absent', () => {
    renderHook(() => useDocumentMeta('X', 'Y'))

    expect(document.title).toBe('X')
    const tags = getDescriptionMetaTags()
    expect(tags.length).toBe(1)
    expect(tags[0].getAttribute('content')).toBe('Y')
  })

  it('mutates the existing meta tag in place on re-render, never creating a second one', () => {
    const { rerender } = renderHook(
      ({ title, description }) => useDocumentMeta(title, description),
      { initialProps: { title: 'X', description: 'Y' } },
    )

    expect(document.title).toBe('X')
    expect(getDescriptionMetaTags().length).toBe(1)

    rerender({ title: 'X2', description: 'Y2' })

    expect(document.title).toBe('X2')
    const tags = getDescriptionMetaTags()
    expect(tags.length).toBe(1)
    expect(tags[0].getAttribute('content')).toBe('Y2')
  })

  it('reuses a meta description tag that already existed in the document', () => {
    const existing = document.createElement('meta')
    existing.setAttribute('name', 'description')
    existing.setAttribute('content', 'original')
    document.head.appendChild(existing)

    renderHook(() => useDocumentMeta('Title', 'New description'))

    const tags = getDescriptionMetaTags()
    expect(tags.length).toBe(1)
    expect(tags[0]).toBe(existing)
    expect(tags[0].getAttribute('content')).toBe('New description')
  })
})
