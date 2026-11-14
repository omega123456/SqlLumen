import DateTimeCellEditor from '../table-data/DateTimeCellEditor'
import { getTemporalColumnType } from '../../lib/date-utils'
import JsonCellEditor from './JsonCellEditor'
import { isEnumColumn } from '../table-data/enum-field-utils'
import type { TableDataColumnMeta, ForeignKeyColumnInfo } from '../../types/schema'
import type { CellEditorBaseProps } from './grid-cell-editors'
import type { EditorCallbacksContextType } from './editor-callbacks-context'
import { EnumCellEditor, NullableCellEditor } from './grid-cell-editors'
import { isJsonSqlType } from '../../lib/grid-column-style'

export type GridEditorType = 'text' | 'enum' | 'set' | 'datetime' | 'fk' | 'json' | 'none'

export interface CellEditorConfig {
  renderEditCell: (props: CellEditorBaseProps) => React.ReactElement
  editorType: GridEditorType
  editorOptions?: {
    commitOnOutsideClick?: boolean
    closeOnExternalRowChange?: boolean
  }
}

interface EditorBinding {
  column: TableDataColumnMeta | undefined
  callbacks: EditorCallbacksContextType
  foreignKey: ForeignKeyColumnInfo | undefined
}

interface ColumnEditorBinding extends EditorBinding {
  column: TableDataColumnMeta
}

const SHARED_EDITOR_OPTIONS = { closeOnExternalRowChange: false }
const OVERLAY_EDITOR_OPTIONS = { ...SHARED_EDITOR_OPTIONS, commitOnOutsideClick: false }

function storeCallbackProps(callbacks: EditorCallbacksContextType) {
  return {
    tabId: callbacks.tabId,
    updateCellValue: callbacks.updateCellValue,
    syncCellValue: callbacks.syncCellValue,
  }
}

function dateTimeEditorConfig({ column, callbacks }: ColumnEditorBinding): CellEditorConfig {
  return {
    editorType: 'datetime',
    renderEditCell: (props: CellEditorBaseProps) => (
      <DateTimeCellEditor
        {...props}
        isNullable={column.isNullable}
        columnMeta={column}
        {...storeCallbackProps(callbacks)}
      />
    ),
    editorOptions: OVERLAY_EDITOR_OPTIONS,
  }
}

function enumEditorConfig({
  column,
  callbacks,
  foreignKey,
}: ColumnEditorBinding): CellEditorConfig {
  return {
    editorType: foreignKey ? 'fk' : 'enum',
    renderEditCell: (props: CellEditorBaseProps) => (
      <EnumCellEditor
        {...props}
        isNullable={column.isNullable}
        columnMeta={column}
        foreignKey={foreignKey}
        {...storeCallbackProps(callbacks)}
      />
    ),
    editorOptions: OVERLAY_EDITOR_OPTIONS,
  }
}

function jsonEditorConfig({
  column,
  callbacks,
  foreignKey,
}: ColumnEditorBinding): CellEditorConfig {
  return {
    editorType: 'json',
    renderEditCell: (props: CellEditorBaseProps) => (
      <JsonCellEditor
        {...props}
        isNullable={column.isNullable}
        columnMeta={column}
        foreignKey={foreignKey}
        {...storeCallbackProps(callbacks)}
      />
    ),
    editorOptions: OVERLAY_EDITOR_OPTIONS,
  }
}

function textEditorConfig({ column, callbacks, foreignKey }: EditorBinding): CellEditorConfig {
  return {
    editorType: foreignKey ? 'fk' : 'text',
    renderEditCell: (props: CellEditorBaseProps) => (
      <NullableCellEditor
        {...props}
        isNullable={column?.isNullable ?? false}
        columnMeta={column}
        foreignKey={foreignKey}
        {...storeCallbackProps(callbacks)}
      />
    ),
    editorOptions: SHARED_EDITOR_OPTIONS,
  }
}

function isTemporalColumn(column: TableDataColumnMeta): boolean {
  return getTemporalColumnType(column.dataType) !== null
}

export function getCellEditorForColumn(
  column: TableDataColumnMeta | undefined,
  callbacks: EditorCallbacksContextType,
  foreignKey?: ForeignKeyColumnInfo
): CellEditorConfig {
  const binding = { column, callbacks, foreignKey }
  if (!column) return textEditorConfig(binding)
  const columnBinding = { column, callbacks, foreignKey }
  if (isTemporalColumn(column)) return dateTimeEditorConfig(columnBinding)
  if (isEnumColumn(column)) return enumEditorConfig(columnBinding)
  if (isJsonSqlType(column.dataType)) return jsonEditorConfig(columnBinding)
  return textEditorConfig(binding)
}
