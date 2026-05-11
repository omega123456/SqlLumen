import { useCallback, useRef, type ComponentType, type FunctionComponent } from 'react'
import {
  GridCellKind,
  type GridCell,
  type TextCell,
  type ProvideEditorCallbackResult,
} from '@glideapps/glide-data-grid'
import type { GridColumn } from './glide-grid-types'
import DateTimeCellEditor from '../../table-data/DateTimeCellEditor'
import { EnumCellEditor, NullableCellEditor, type CellEditorBaseProps } from '../grid-cell-editors'
import type { GridEditorType } from '../grid-column-editor-utils'

export interface CustomEditorProps {
  value: GridCell
  onChange: (newValue: GridCell) => void
  onFinishedEditing: (newCell?: GridCell, movement?: readonly [-1 | 0 | 1, -1 | 0 | 1]) => void
}

interface GlideEditorCellData {
  row: Record<string, unknown>
  columnKey: string
  columnMeta?: CellEditorBaseProps['columnMeta']
  isNullable: boolean
  foreignKey?: CellEditorBaseProps['foreignKey']
}

export type GlideEditableTextCell = TextCell & {
  data: string
  glideEditorData?: GlideEditorCellData
}

function extractEditorData(cell: GridCell): GlideEditorCellData | null {
  if (cell.kind !== GridCellKind.Text) return null
  return (cell as GlideEditableTextCell).glideEditorData ?? null
}

type VendorNeutralEditorComponent = ComponentType<CellEditorBaseProps>

export function wrapEditorAsGlideOverlay(
  EditorComponent: VendorNeutralEditorComponent
): FunctionComponent<CustomEditorProps> {
  return function GlideOverlayEditor({ value, onChange, onFinishedEditing }: CustomEditorProps) {
    const currentValueRef = useRef(value)
    const editorData = extractEditorData(value)
    if (!editorData) return null

    const { row, columnKey, columnMeta, isNullable, foreignKey } = editorData
    const close = useCallback(
      (commitChanges?: boolean) => {
        onFinishedEditing(commitChanges === false ? undefined : currentValueRef.current)
      },
      [onFinishedEditing]
    )
    return (
      <EditorComponent
        row={row}
        column={{ key: columnKey }}
        isNullable={isNullable}
        columnMeta={columnMeta}
        foreignKey={foreignKey}
        onRowChange={(nextRow) => {
          const nextValue = nextRow[columnKey]
          const text = nextValue == null ? '' : String(nextValue)
          const nextCell = {
            ...(value as TextCell),
            data: text,
            displayData: nextValue == null ? 'NULL' : text,
            copyData: nextValue == null ? 'NULL' : text,
          }
          currentValueRef.current = nextCell
          onChange(nextCell)
        }}
        onClose={close}
      />
    )
  }
}

const wrappedNullableEditor = wrapEditorAsGlideOverlay(NullableCellEditor)
const wrappedEnumEditor = wrapEditorAsGlideOverlay(EnumCellEditor)
const wrappedDateTimeEditor = wrapEditorAsGlideOverlay(
  DateTimeCellEditor as VendorNeutralEditorComponent
)

export function getGlideEditor(
  _column: GridColumn<unknown>,
  editorType: GridEditorType
): ProvideEditorCallbackResult<GridCell> | null {
  if (editorType === 'none') return null
  if (editorType === 'enum') return wrappedEnumEditor
  if (editorType === 'datetime') return wrappedDateTimeEditor
  return wrappedNullableEditor
}
