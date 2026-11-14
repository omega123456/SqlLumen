import { base64ToBytes, envelopeForBytes, nullEnvelope } from '../../../lib/blob-utils'
import { showErrorToast } from '../../../stores/toast-store'
import type { BlobValueResponse } from '../../../types/schema'
import { BYTES_PER_MEGABYTE } from '../../../lib/units'
import { toErrorMessage } from '../../../lib/error-message'

/** Hard cap (10 MB) enforced on file loads inside the dialog. */
const FILE_LOAD_CAP_MEGABYTES = 10
export const FILE_LOAD_CAP = FILE_LOAD_CAP_MEGABYTES * BYTES_PER_MEGABYTE
export const HEX_DUMP_GROUP_SIZE = 8

export type BlobTab = 'image' | 'text' | 'hex'

export const TABS: { id: BlobTab; label: string }[] = [
  { id: 'image', label: 'Image' },
  { id: 'text', label: 'Text' },
  { id: 'hex', label: 'Hex' },
]

/**
 * The dialog's working value. `bytes` carries actual content; `null` is a
 * staged SQL NULL; `tooLarge` means no bytes are held (table-data fetch refused
 * them) so content and Save-to-file are suppressed.
 */
export type WorkingValue =
  { kind: 'bytes'; bytes: Uint8Array } | { kind: 'null' } | { kind: 'tooLarge'; byteLength: number }

/** Resolve a `WorkingValue` from a fetched/inlined `BlobValueResponse`. */
export function workingFromResponse(response: BlobValueResponse): WorkingValue {
  if (response.tooLarge) {
    return { kind: 'tooLarge', byteLength: response.byteLength }
  }
  if (response.base64 === null) {
    return { kind: 'null' }
  }
  return { kind: 'bytes', bytes: base64ToBytes(response.base64) }
}

export const EMPTY_WORKING_VALUE: WorkingValue = { kind: 'bytes', bytes: new Uint8Array(0) }

export function decodeInitialBase64(initialBase64: string | null | undefined): WorkingValue {
  if (initialBase64 == null) return { kind: 'null' }
  try {
    return { kind: 'bytes', bytes: base64ToBytes(initialBase64) }
  } catch (error) {
    showErrorToast('Failed to decode BLOB value', toErrorMessage(error))
    return EMPTY_WORKING_VALUE
  }
}

export function envelopeForWorkingValue(working: Exclude<WorkingValue, { kind: 'tooLarge' }>) {
  if (working.kind === 'null') return nullEnvelope()
  return envelopeForBytes(working.bytes)
}

export function workingBytesOf(working: WorkingValue | null): Uint8Array | null {
  return working?.kind === 'bytes' ? working.bytes : null
}

export function workingByteCount(working: WorkingValue | null): number | null {
  if (working?.kind === 'bytes') return working.bytes.length
  if (working?.kind === 'tooLarge') return working.byteLength
  return null
}

export function hasByteMetadata(working: WorkingValue | null): boolean {
  return working?.kind === 'bytes' || working?.kind === 'tooLarge'
}

export function hasBytes(bytes: Uint8Array | null): bytes is Uint8Array {
  if (!bytes) return false
  return bytes.length > 0
}

export function saveButtonTitle(canSave: boolean, tooLarge: boolean): string {
  const isTooLargeToSave = !canSave && tooLarge
  if (isTooLargeToSave) return 'Too large to load — exceeds 10 MB'
  return 'Save bytes to a file'
}

export function nextTabIndex(key: string, index: number): number | null {
  const deltaByKey: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }
  const delta = deltaByKey[key]
  if (delta === undefined) return null
  return (index + delta + TABS.length) % TABS.length
}
