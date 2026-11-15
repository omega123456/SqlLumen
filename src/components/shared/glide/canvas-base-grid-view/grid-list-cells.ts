import {
  GridCellKind,
  type CustomRenderer,
  type EditableGridCell,
  type GridCell,
} from '@glideapps/glide-data-grid'
import {
  DropdownCell as DropdownCellRenderer,
  MultiSelectCell as MultiSelectCellRenderer,
  type DropdownCellType,
  type MultiSelectCellType,
} from '@glideapps/glide-data-grid-cells'
import { parseSetCellValue } from '../../enum-field-utils'
import { nullCellThemeOverride } from '../glide-cell-content'
import type { EnumGridColumn, GlideDropdownOption, SetGridColumn } from './canvas-grid-types'

const LAST_ASCII_CONTROL_CODE = 0x1f

export const CUSTOM_RENDERERS: CustomRenderer[] = [
  DropdownCellRenderer as unknown as CustomRenderer,
  MultiSelectCellRenderer as unknown as CustomRenderer,
]

function deriveNullSentinel(enumValues: string[]): string {
  for (let index = 0; index <= LAST_ASCII_CONTROL_CODE; index += 1) {
    const candidate = String.fromCharCode(index)
    if (!enumValues.includes(candidate)) return candidate
  }
  let index = 0
  while (true) {
    const candidate = `\0NULL${index}`
    if (!enumValues.includes(candidate)) return candidate
    index += 1
  }
}

function buildEnumAllowedValues(column: EnumGridColumn): GlideDropdownOption[] {
  if (column.isNullable !== true) return column.enumValues
  return [{ value: deriveNullSentinel(column.enumValues), label: 'NULL' }, ...column.enumValues]
}

function getDropdownOptionValue(option: GlideDropdownOption | null | undefined): string | null {
  if (typeof option === 'string') return option
  return option?.value ?? null
}

export function isDropdownNullSelection(
  column: EnumGridColumn,
  value: string | null | undefined
): boolean {
  if (column.isNullable !== true) return false
  if (value == null) return false
  const nullOptionValue = getDropdownOptionValue(buildEnumAllowedValues(column)[0])
  return nullOptionValue === value
}

function isCustomCellOfKind(cell: EditableGridCell, kind: string): boolean {
  return (
    cell.kind === GridCellKind.Custom &&
    typeof cell.data === 'object' &&
    cell.data !== null &&
    'kind' in cell.data &&
    cell.data.kind === kind
  )
}

export function isDropdownCustomCell(cell: EditableGridCell): cell is DropdownCellType {
  return isCustomCellOfKind(cell, 'dropdown-cell')
}

export function isMultiSelectCustomCell(cell: EditableGridCell): cell is MultiSelectCellType {
  return isCustomCellOfKind(cell, 'multi-select-cell')
}

export function buildEnumDropdownCell(
  column: EnumGridColumn,
  value: string | null,
  editable: boolean
): DropdownCellType {
  const allowedValues = buildEnumAllowedValues(column)
  const nullSentinel = getDropdownOptionValue(allowedValues[0])

  return {
    kind: GridCellKind.Custom,
    allowOverlay: editable,
    readonly: !editable,
    copyData: value ?? 'NULL',
    ...(value == null ? { themeOverride: nullCellThemeOverride() } : {}),
    data: {
      kind: 'dropdown-cell',
      value: value ?? nullSentinel,
      allowedValues: allowedValues,
    },
  }
}

export function buildSetMultiSelectCell(
  column: SetGridColumn,
  value: string | null,
  editable: boolean
): MultiSelectCellType {
  return {
    kind: GridCellKind.Custom,
    allowOverlay: editable,
    readonly: !editable,
    copyData: value ?? 'NULL',
    ...(value == null ? { themeOverride: nullCellThemeOverride() } : {}),
    data: {
      kind: 'multi-select-cell',
      values: parseSetCellValue(value) ?? null,
      options: column.setValues,
      allowCreation: false,
      allowDuplicates: false,
    },
  }
}

export function pasteTextIntoCell(cell: GridCell, text: string): EditableGridCell | undefined {
  if (cell.kind === GridCellKind.Text) {
    const isUnchangeable = cell.readonly === true || text === cell.data
    if (isUnchangeable) return undefined
    return { ...cell, data: text }
  }
  if (cell.kind === GridCellKind.Custom) {
    if (cell.readonly === true) return undefined
    const renderer = CUSTOM_RENDERERS.find((candidate) => candidate.isMatch(cell))
    const data = renderer?.onPaste?.(text, cell.data)
    return data === undefined ? undefined : { ...cell, data }
  }
  return undefined
}
