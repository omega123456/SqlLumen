import { getDefaultColumnWidth, HEADER_ICON_WIDTH_PX } from '../../../../lib/grid-column-style'
import { isGeneratedColumn } from '../../../../lib/column-capabilities'
import type { GridColumnDescriptor } from '../../../../types/shared-data-view'
import type { GridColumn } from '../glide-grid-types'
import type {
  CanvasBaseGridViewProps,
  EnumGridColumn,
  GridRow,
  SetGridColumn,
} from './canvas-grid-types'

type AutoSizeConfig = CanvasBaseGridViewProps['autoSizeConfig']
type EditableColumnKeys = ReadonlySet<string> | undefined

function resolveConfiguredColumnWidth(
  column: GridColumnDescriptor,
  rows: readonly GridRow[],
  autoSizeConfig: AutoSizeConfig
): number | undefined {
  if (typeof column.width === 'number') return column.width
  if (autoSizeConfig?.enabled !== true) return undefined
  return autoSizeConfig.computeWidth(column, rows)
}

export function toGridColumn(
  column: GridColumnDescriptor,
  rows: readonly GridRow[],
  autoSizeConfig: AutoSizeConfig
): GridColumn<GridRow> {
  const computedWidth = resolveConfiguredColumnWidth(column, rows, autoSizeConfig)
  return {
    key: column.key,
    name: column.displayName,
    dataType: column.dataType,
    width:
      computedWidth ??
      (column.editable
        ? getDefaultColumnWidth(column.dataType)
        : getDefaultColumnWidth(column.dataType) + HEADER_ICON_WIDTH_PX),
    resizable: true,
    sortable: true,
    editable: column.editable,
    foreignKey: column.foreignKey,
    isNullable: column.isNullable,
    isBinary: column.isBinary,
    isGenerated: isGeneratedColumn(column.tableColumnMeta),
    blobViewerEditable: column.blobViewerEditable,
    tableColumnMeta: column.tableColumnMeta,
    editorType: column.editorType,
    enumValues: column.enumValues,
    setValues: column.setValues,
  }
}

export function isInfoColumn(column: GridColumn<GridRow>): boolean {
  return column.key === 'info'
}

export function isEnumColumn(column: GridColumn<GridRow> | undefined): column is EnumGridColumn {
  return (
    column?.editorType === 'enum' &&
    Array.isArray(column.enumValues) &&
    column.enumValues.length > 0
  )
}

export function isSetColumn(column: GridColumn<GridRow> | undefined): column is SetGridColumn {
  return (
    column?.editorType === 'set' && Array.isArray(column.setValues) && column.setValues.length > 0
  )
}

export function isListSelectionColumn(
  column: GridColumn<GridRow> | undefined
): column is EnumGridColumn | SetGridColumn {
  return isEnumColumn(column) || isSetColumn(column)
}

export function isEditableColumn(
  column: GridColumn<GridRow>,
  isEditMode: boolean | undefined,
  editableColumnKeys: EditableColumnKeys
): boolean {
  return (
    isEditMode === true &&
    column.editable === true &&
    editableColumnKeys?.has(column.key) === true &&
    column.isBinary !== true &&
    column.editorType !== 'none'
  )
}

export function isEditableListColumn(
  column: GridColumn<GridRow> | undefined,
  isEditMode: boolean | undefined,
  editableColumnKeys: EditableColumnKeys
): column is EnumGridColumn | SetGridColumn {
  return isListSelectionColumn(column) && isEditableColumn(column, isEditMode, editableColumnKeys)
}

export function isReadOnlyInEditMode(
  column: GridColumn<GridRow>,
  isEditMode: boolean | undefined,
  editableColumnKeys: EditableColumnKeys
): boolean {
  return isEditMode === true && editableColumnKeys?.has(column.key) !== true
}

export function hasInfoText(
  column: GridColumn<GridRow> | undefined,
  row: GridRow | undefined
): boolean {
  if (!column) return false
  if (!isInfoColumn(column)) return false
  return typeof row?.info === 'string' && row.info.length > 0
}

export function isForeignKeyLookupColumn(
  column: GridColumn<GridRow> | undefined
): column is GridColumn<GridRow> {
  if (!column?.foreignKey) return false
  return !isListSelectionColumn(column)
}

export function isClearableColumn(
  column: GridColumn<GridRow> | undefined
): column is GridColumn<GridRow> {
  return column !== undefined && !isInfoColumn(column)
}
