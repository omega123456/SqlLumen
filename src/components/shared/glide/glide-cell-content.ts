import { GridCellKind, type GridCell, type TextCell } from '@glideapps/glide-data-grid'
import {
  base64ByteLength,
  base64ToBytes,
  blobPlaceholder,
  isBlobEnvelope,
} from '../../../lib/blob-utils'
import type { BlobEnvelope } from '../../../types/schema'

export interface CellStateFlags {
  isNull: boolean
  isBlob: boolean
  isReadOnly: boolean
  isModified: boolean
  isFkCell: boolean
  isSelectedRow: boolean
  isEditingRow: boolean
  isNewRow: boolean
  isHighlightedColumn: boolean
}

export interface ClassifyCellValueOptions {
  isReadOnly?: boolean
  isModified?: boolean
  isFkCell?: boolean
  isSelectedRow?: boolean
  isEditingRow?: boolean
  isNewRow?: boolean
  highlightedColumnKey?: string
  isBlobColumn?: boolean
}

export type ClassifiedCellValue = CellStateFlags & { displayValue: string; copyValue: string }

export const NULL_CELL_THEME_OVERRIDE = {
  baseFontStyle: 'italic 13px',
  textDark: 'rgba(128, 128, 128, 0.75)',
} as const

/**
 * Render the placeholder shown for a binary cell.
 *
 * `isBlobColumn` is set when the cell belongs to a binary column whose value
 * arrives as inlined base64 (query results) — those have no pre-baked
 * `[BLOB - …]` placeholder, so the byte size is derived here. This keeps query
 * results identical to the table grid, which receives the placeholder ready-made
 * from the backend.
 */
export function formatBlobDisplayValue(rawValue: unknown, isBlobColumn = false): string {
  if (typeof rawValue === 'string') {
    if (rawValue.startsWith('[BLOB')) return rawValue
    if (isBlobColumn) return blobPlaceholder(base64ByteLength(rawValue))
    return '[BLOB]'
  }
  if (rawValue instanceof Uint8Array) return blobPlaceholder(rawValue.byteLength)
  if (rawValue instanceof ArrayBuffer) return blobPlaceholder(rawValue.byteLength)
  return '[BLOB]'
}

/**
 * Decode the byte length of a `bytes`/`empty` blob envelope without keeping the
 * decoded bytes around. Malformed base64 falls back to 0.
 */
function envelopeByteLength(envelope: BlobEnvelope): number {
  if (envelope.kind === 'empty') return 0
  if (envelope.kind === 'bytes' && typeof envelope.base64 === 'string') {
    try {
      return base64ToBytes(envelope.base64).byteLength
    } catch {
      return 0
    }
  }
  return 0
}

export function classifyCellValue(
  rawValue: unknown,
  columnKey: string,
  options: ClassifyCellValueOptions = {}
): ClassifiedCellValue {
  // A staged blob edit arrives as a self-describing envelope. Render it as a
  // modified blob placeholder (`[BLOB - N bytes*]`) or, for a staged NULL, fall
  // through to the standard NULL rendering with the pending highlight.
  if (isBlobEnvelope(rawValue)) {
    if (rawValue.kind === 'null') {
      return {
        displayValue: 'NULL',
        copyValue: 'NULL',
        isNull: true,
        isBlob: false,
        isReadOnly: options.isReadOnly ?? false,
        isModified: options.isModified ?? false,
        isFkCell: options.isFkCell ?? false,
        isSelectedRow: options.isSelectedRow ?? false,
        isEditingRow: options.isEditingRow ?? false,
        isNewRow: options.isNewRow ?? false,
        isHighlightedColumn: options.highlightedColumnKey === columnKey,
      }
    }
    const placeholder = blobPlaceholder(envelopeByteLength(rawValue), true)
    return {
      displayValue: placeholder,
      copyValue: placeholder,
      isNull: false,
      isBlob: true,
      isReadOnly: options.isReadOnly ?? false,
      isModified: options.isModified ?? false,
      isFkCell: options.isFkCell ?? false,
      isSelectedRow: options.isSelectedRow ?? false,
      isEditingRow: options.isEditingRow ?? false,
      isNewRow: options.isNewRow ?? false,
      isHighlightedColumn: options.highlightedColumnKey === columnKey,
    }
  }

  const isNull = rawValue == null
  const isBlob =
    !isNull &&
    (options.isBlobColumn === true ||
      rawValue instanceof Uint8Array ||
      rawValue instanceof ArrayBuffer ||
      (typeof rawValue === 'string' && rawValue.startsWith('[BLOB')))
  const displayValue = isNull
    ? 'NULL'
    : isBlob
      ? formatBlobDisplayValue(rawValue, options.isBlobColumn === true)
      : String(rawValue)

  return {
    displayValue,
    copyValue: displayValue,
    isNull,
    isBlob,
    isReadOnly: options.isReadOnly ?? false,
    isModified: options.isModified ?? false,
    isFkCell: options.isFkCell ?? false,
    isSelectedRow: options.isSelectedRow ?? false,
    isEditingRow: options.isEditingRow ?? false,
    isNewRow: options.isNewRow ?? false,
    isHighlightedColumn: options.highlightedColumnKey === columnKey,
  }
}

export function buildTextCell(
  displayValue: string,
  flags: CellStateFlags,
  copyValue = displayValue
): GridCell {
  return {
    kind: GridCellKind.Text,
    displayData: displayValue,
    data: displayValue,
    copyData: copyValue,
    allowOverlay: false,
    readonly: true,
    style: flags.isReadOnly ? 'faded' : 'normal',
  } satisfies TextCell
}

export function buildNullCell(copyValue = 'NULL'): GridCell {
  return {
    kind: GridCellKind.Text,
    displayData: 'NULL',
    data: '',
    copyData: copyValue,
    allowOverlay: false,
    readonly: true,
    themeOverride: NULL_CELL_THEME_OVERRIDE,
  } satisfies TextCell
}

export function buildBlobCell(displayValue: string, copyValue = displayValue): GridCell {
  return {
    kind: GridCellKind.Text,
    displayData: displayValue,
    data: displayValue,
    copyData: copyValue,
    allowOverlay: false,
    readonly: true,
    style: 'faded',
    themeOverride: { textDark: 'rgba(128, 128, 128, 0.7)' },
  } satisfies TextCell
}

export function buildFkCell(
  displayValue: string,
  flags: CellStateFlags,
  copyValue = displayValue
): GridCell {
  return buildTextCell(displayValue, { ...flags, isFkCell: true }, copyValue)
}
