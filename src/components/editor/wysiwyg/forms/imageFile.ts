/**
 * wysiwyg/forms/imageFile.ts
 *
 * Pure helpers for reading image files into data: URIs.
 * No DOM dependencies beyond FileReader — fully unit-testable.
 */

/** Files larger than this threshold trigger a warning in the UI. */
export const SIZE_WARNING_BYTES = 1_048_576 // 1 MiB

/** Returns true if the File's MIME type starts with "image/". */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

/**
 * Human-readable file size string.
 * e.g. 512 B, 2.4 KB, 1.8 MB
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Reads a File into a base64 data: URI using FileReader.
 * Returns a Promise that resolves with the full data URI string.
 */
export function fileToDataUri(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`FileReader failed: ${reader.error?.message ?? 'unknown error'}`))
    reader.readAsDataURL(file)
  })
}
