import { GridCellKind, type GridCell, type TextCell } from '@glideapps/glide-data-grid'

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

export function formatBlobDisplayValue(rawValue: unknown): string {
  if (typeof rawValue === 'string' && rawValue.startsWith('[BLOB')) return rawValue
  if (rawValue instanceof Uint8Array) return `[BLOB ${rawValue.byteLength} B]`
  if (rawValue instanceof ArrayBuffer) return `[BLOB ${rawValue.byteLength} B]`
  return '[BLOB]'
}

export function classifyCellValue(
  rawValue: unknown,
  columnKey: string,
  options: ClassifyCellValueOptions = {}
): ClassifiedCellValue {
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
      ? formatBlobDisplayValue(rawValue)
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
    themeOverride: { baseFontStyle: 'italic 13px', textDark: 'rgba(128, 128, 128, 0.75)' },
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
