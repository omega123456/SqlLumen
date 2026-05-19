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
  col: TableDataColumnMeta | undefined,
  callbacks: CellEditorCallbackProps,
  foreignKey?: ForeignKeyColumnInfo
): CellEditorConfig {
  const temporalType = col ? getTemporalColumnType(col.dataType) : null
  const sharedEditorOptions = { closeOnExternalRowChange: false }

  if (temporalType && col) {
    return {
      editorType: 'datetime',
      renderEditCell: (props: CellEditorBaseProps) => (
        <DateTimeCellEditor
          {...props}
          isNullable={col.isNullable}
          columnMeta={col}
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

  if (col && isEnumColumn(col)) {
    return {
      editorType: foreignKey ? 'fk' : 'enum',
      renderEditCell: (props: CellEditorBaseProps) => (
        <EnumCellEditor
          {...props}
          isNullable={col.isNullable}
          columnMeta={col}
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

  if (col?.dataType.trim().toUpperCase() === 'JSON') {
    return {
      editorType: 'json',
      renderEditCell: (props: CellEditorBaseProps) => (
        <JsonCellEditor
          {...props}
          isNullable={col.isNullable}
          columnMeta={col}
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
        isNullable={col?.isNullable ?? false}
        columnMeta={col}
        foreignKey={foreignKey}
        tabId={callbacks.tabId}
        updateCellValue={callbacks.updateCellValue}
        syncCellValue={callbacks.syncCellValue}
      />
    ),
    editorOptions: sharedEditorOptions,
  }
}
