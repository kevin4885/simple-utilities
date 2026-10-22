import { afterEach, describe, expect, it, vi } from 'vitest'
import { base64ByteLength, base64ToBytes, cleanBase64, copyText, downloadBlob } from './viewerIo'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('downloadBlob', () => {
  it('creates an object URL, clicks an anchor, and revokes the URL afterwards', () => {
    const create = vi.fn(() => 'blob:fake')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('f.bin')
      expect(this.href).toContain('blob:fake')
      expect(revoke).not.toHaveBeenCalled()
    })
    downloadBlob('f.bin', new Uint8Array([1, 2]), 'application/octet-stream')
    expect(create).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:fake')
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('still revokes the URL when click throws', () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: revoke }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => downloadBlob('f', 'x', 'text/plain')).toThrow('boom')
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })
})

describe('copyText', () => {
  it('writes to the clipboard and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyText('hi')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hi')
  })

  it('returns false when the clipboard rejects or is missing', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } })
    expect(await copyText('x')).toBe(false)
    vi.stubGlobal('navigator', {})
    expect(await copyText('x')).toBe(false)
  })
})

describe('base64 helpers', () => {
  it('cleans whitespace and rejects malformed input', () => {
    expect(cleanBase64('aGVs\nbG8=')).toBe('aGVsbG8=')
    expect(cleanBase64('not base64!')).toBeNull()
    expect(cleanBase64('a')).toBeNull()
  })

  it('computes byte length with padding', () => {
    expect(base64ByteLength('aGVsbG8=')).toBe(5)
    expect(base64ByteLength('aGk=')).toBe(2)
    expect(base64ByteLength('aGVsbA==')).toBe(4)
    expect(base64ByteLength('')).toBe(0)
  })

  it('decodes to bytes', () => {
    expect(Array.from(base64ToBytes('aGk='))).toEqual([104, 105])
  })
})
