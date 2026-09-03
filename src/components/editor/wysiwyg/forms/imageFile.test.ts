/**
 * wysiwyg/forms/imageFile.test.ts
 *
 * Unit tests for imageFile.ts pure helpers.
 */
import { describe, it, expect } from 'vitest'
import {
  isImageFile,
  formatBytes,
  SIZE_WARNING_BYTES,
} from './imageFile'

describe('isImageFile', () => {
  it('returns true for image/png', () => {
    const f = new File([''], 'test.png', { type: 'image/png' })
    expect(isImageFile(f)).toBe(true)
  })

  it('returns true for image/jpeg', () => {
    const f = new File([''], 'test.jpg', { type: 'image/jpeg' })
    expect(isImageFile(f)).toBe(true)
  })

  it('returns false for text/plain', () => {
    const f = new File([''], 'test.txt', { type: 'text/plain' })
    expect(isImageFile(f)).toBe(false)
  })

  it('returns false for application/pdf', () => {
    const f = new File([''], 'test.pdf', { type: 'application/pdf' })
    expect(isImageFile(f)).toBe(false)
  })
})

describe('formatBytes', () => {
  it('formats bytes < 1024 as B', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('formats bytes in KB range', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(2457)).toBe('2.4 KB')
  })

  it('formats bytes in MB range', () => {
    expect(formatBytes(1_048_576)).toBe('1.0 MB')
    expect(formatBytes(1_887_437)).toBe('1.8 MB')
  })
})

describe('SIZE_WARNING_BYTES', () => {
  it('is 1 MiB (1048576)', () => {
    expect(SIZE_WARNING_BYTES).toBe(1_048_576)
  })
})
