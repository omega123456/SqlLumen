import DateTimeCellEditor from '../table-data/DateTimeCellEditor'
import { getTemporalColumnType } from '../../lib/date-utils'
import JsonCellEditor from './JsonCellEditor'
import {
  ENUM_NULL_SENTINEL,
  getEnumFallbackValue,
  isEnumColumn,
} from '../table-data/enum-field-utils'
import type { TableDataColumnMeta, ForeignKeyColumnInfo } from '../../types/schema'
import type { CellEditorBaseProps, CellEditorCallbackProps } from './grid-cell-editors'
import { EnumCellEditor, NullableCellEditor } from './grid-cell-editors'

export type GridEditorType = 'text' | 'enum' | 'set' | 'datetime' | 'fk' | 'json' | 'none'

export interface CellEditorConfig {
  renderEditCell: (props: CellEditorBaseProps) => React.ReactElement
  editorType: GridEditorType
  editorOptions?: {
    commitOnOutsideClick?: boolean
    closeOnExternalRowChange?: boolean
  }
}

void ENUM_NULL_SENTINEL
void getEnumFallbackValue

export function getCellEditorForColumn(
  column: TableDataColumnMeta | undefined,
  callbacks: CellEditorCallbackProps,
  foreignKey?: ForeignKeyColumnInfo
): CellEditorConfig {
  const temporalType = column ? getTemporalColumnType(column.dataType) : null
  const sharedEditorOptions = { closeOnExternalRowChange: false }

  if (temporalType && column) {
    return {
      editorType: 'datetime',
      renderEditCell: (props: CellEditorBaseProps) => (
        <DateTimeCellEditor
          {...props}
          isNullable={column.isNullable}
          columnMeta={column}
          tabId={callbacks.tabId}
          updateCellValue={callbacks.updateCellValue}
          syncCellValue={callbacks.syncCellValue}
        />
      ),
      editorOptions: {
        ...sharedEditorOptions,
        commitOnOutsideClick: false,
      },
    }
  }

  if (column && isEnumColumn(column)) {
    return {
      editorType: foreignKey ? 'fk' : 'enum',
      renderEditCell: (props: CellEditorBaseProps) => (
        <EnumCellEditor
          {...props}
          isNullable={column.isNullable}
          columnMeta={column}
          foreignKey={foreignKey}
          tabId={callbacks.tabId}
          updateCellValue={callbacks.updateCellValue}
          syncCellValue={callbacks.syncCellValue}
        />
      ),
      editorOptions: {
        ...sharedEditorOptions,
        commitOnOutsideClick: false,
      },
    }
  }

  if (column?.dataType.trim().toUpperCase() === 'JSON') {
    return {
      editorType: 'json',
      renderEditCell: (props: CellEditorBaseProps) => (
        <JsonCellEditor
          {...props}
          isNullable={column.isNullable}
          columnMeta={column}
          foreignKey={foreignKey}
          tabId={callbacks.tabId}
          updateCellValue={callbacks.updateCellValue}
          syncCellValue={callbacks.syncCellValue}
        />
      ),
      editorOptions: {
        ...sharedEditorOptions,
        commitOnOutsideClick: false,
      },
    }
  }

  return {
    editorType: foreignKey ? 'fk' : 'text',
    renderEditCell: (props: CellEditorBaseProps) => (
      <NullableCellEditor
        {...props}
        isNullable={column?.isNullable ?? false}
        columnMeta={column}
        foreignKey={foreignKey}
        tabId={callbacks.tabId}
        updateCellValue={callbacks.updateCellValue}
        syncCellValue={callbacks.syncCellValue}
      />
    ),
    editorOptions: sharedEditorOptions,
  }
}
