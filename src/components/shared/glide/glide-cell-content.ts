import { GridCellKind, type GridCell, type TextCell } from '@glideapps/glide-data-grid'
import {
  base64ByteLength,
  base64ToBytes,
  blobPlaceholder,
  isBlobEnvelope,
  isBlobPlaceholderText,
} from '../../../lib/blob-utils'
import { logParseFallback } from '../../../lib/app-log-commands'
import { currentTheme, readThemeColor, readToken, type ThemeName } from '../../../lib/theme-tokens'
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

let nullTokenCache: { theme: ThemeName; color: string; mono: string } | null = null

function nullTokens(): { color: string; mono: string } {
  const theme = currentTheme()
  if (nullTokenCache?.theme === theme) return nullTokenCache
  nullTokenCache = {
    theme: theme,
    color: readThemeColor('outline'),
    mono: readToken('--font-mono'),
  }
  return nullTokenCache
}

function nullTextColor(): string {
  return nullTokens().color
}

export function nullCellThemeOverride(): { baseFontStyle: string; textDark: string } {
  const { color, mono } = nullTokens()
  return { baseFontStyle: mono ? `italic 13px ${mono},` : 'italic 13px', textDark: color }
}

export function formatBlobDisplayValue(rawValue: unknown, isBlobColumn = false): string {
  if (typeof rawValue === 'string') {
    if (isBlobPlaceholderText(rawValue)) return rawValue
    if (isBlobColumn) return blobPlaceholder(base64ByteLength(rawValue))
    return '[BLOB]'
  }
  if (rawValue instanceof Uint8Array) return blobPlaceholder(rawValue.byteLength)
  if (rawValue instanceof ArrayBuffer) return blobPlaceholder(rawValue.byteLength)
  return '[BLOB]'
}

function envelopeByteLength(envelope: BlobEnvelope): number {
  if (envelope.kind === 'empty') return 0
  const base64 = envelope.kind === 'bytes' ? envelope.base64 : undefined
  if (typeof base64 === 'string') {
    try {
      return base64ToBytes(base64).byteLength
    } catch (error) {
      logParseFallback('[glide-cell-content] envelopeByteLength', error)
      return 0
    }
  }
  return 0
}

type RowStateFlags = Omit<CellStateFlags, 'isNull' | 'isBlob'>

function rowStateFlags(options: ClassifyCellValueOptions, columnKey: string): RowStateFlags {
  return {
    isReadOnly: options.isReadOnly ?? false,
    isModified: options.isModified ?? false,
    isFkCell: options.isFkCell ?? false,
    isSelectedRow: options.isSelectedRow ?? false,
    isEditingRow: options.isEditingRow ?? false,
    isNewRow: options.isNewRow ?? false,
    isHighlightedColumn: options.highlightedColumnKey === columnKey,
  }
}

function classifyBlobEnvelope(envelope: BlobEnvelope, flags: RowStateFlags): ClassifiedCellValue {
  if (envelope.kind === 'null') {
    return { displayValue: 'NULL', copyValue: 'NULL', isNull: true, isBlob: false, ...flags }
  }
  const placeholder = blobPlaceholder(envelopeByteLength(envelope), true)
  return {
    displayValue: placeholder,
    copyValue: placeholder,
    isNull: false,
    isBlob: true,
    ...flags,
  }
}

function isBinaryBuffer(value: unknown): value is Uint8Array | ArrayBuffer {
  return value instanceof Uint8Array || value instanceof ArrayBuffer
}

function isBlobValue(rawValue: unknown, isBlobColumn: boolean): boolean {
  if (rawValue == null) return false
  if (isBlobColumn) return true
  if (isBinaryBuffer(rawValue)) return true
  return isBlobPlaceholderText(rawValue)
}

function cellDisplayValue(rawValue: unknown, isBlob: boolean, isBlobColumn: boolean): string {
  if (rawValue == null) return 'NULL'
  if (isBlob) return formatBlobDisplayValue(rawValue, isBlobColumn)
  return String(rawValue)
}

export function classifyCellValue(
  rawValue: unknown,
  columnKey: string,
  options: ClassifyCellValueOptions = {}
): ClassifiedCellValue {
  const flags = rowStateFlags(options, columnKey)
  if (isBlobEnvelope(rawValue)) return classifyBlobEnvelope(rawValue, flags)

  const isBlobColumn = options.isBlobColumn === true
  const isBlob = isBlobValue(rawValue, isBlobColumn)
  const displayValue = cellDisplayValue(rawValue, isBlob, isBlobColumn)
  return {
    displayValue: displayValue,
    copyValue: displayValue,
    isNull: rawValue == null,
    isBlob: isBlob,
    ...flags,
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
    themeOverride: nullCellThemeOverride(),
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
    themeOverride: { textDark: nullTextColor() },
  } satisfies TextCell
}

export function buildForeignKeyCell(
  displayValue: string,
  flags: CellStateFlags,
  copyValue = displayValue
): GridCell {
  return buildTextCell(displayValue, { ...flags, isFkCell: true }, copyValue)
}
