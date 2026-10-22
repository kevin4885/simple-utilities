// Thin IO helpers for the viewers (clipboard, Blob download) plus base64 sizing/decoding.
// Kept separate so the components stay testable with stubs.

/** Copies text to the clipboard. Resolves true on success, false if the clipboard is unavailable or refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Triggers a browser download of `data` as `filename`; the object URL is always revoked afterwards. */
export function downloadBlob(filename: string, data: BlobPart, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    try {
      a.click()
    } finally {
      a.remove()
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

/** Returns the whitespace-stripped base64 string if it is well-formed standard base64, else null. */
export function cleanBase64(data: string): string | null {
  const s = data.replace(/\s+/g, '')
  if (s.length % 4 === 1 || !BASE64_RE.test(s)) return null
  return s
}

/** Decoded byte length of well-formed base64 (as returned by `cleanBase64`). */
export function base64ByteLength(clean: string): number {
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.floor((clean.length * 3) / 4) - padding
}

/** Decodes well-formed base64 (as returned by `cleanBase64`) to bytes. */
export function base64ToBytes(clean: string): Uint8Array<ArrayBuffer> {
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
