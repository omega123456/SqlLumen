import { useCallback, useRef, type ComponentType, type FunctionComponent } from 'react'
import {
  GridCellKind,
  type GridCell,
  type Rectangle,
  type TextCell,
  type ProvideEditorCallbackResult,
} from '@glideapps/glide-data-grid'
import type { GridColumn } from './glide-grid-types'
import DateTimeCellEditor from '../../table-data/DateTimeCellEditor'
import { EnumCellEditor, NullableCellEditor, type CellEditorBaseProps } from '../grid-cell-editors'
import type { GridEditorType } from '../grid-column-editor-utils'

export interface CustomEditorProps {
  target: Rectangle
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
  selectAllOnFocus?: boolean
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

function getEditorTargetWidth(target: Rectangle): number {
  return Math.max(1, Math.floor(target.width))
}

function getMarkerCount(
  editorData: GlideEditorCellData,
  columnMeta?: CellEditorBaseProps['columnMeta']
): number {
  let count = 0
  if (editorData.isNullable) count += 1
  if (editorData.foreignKey) count += 1
  const normalizedType = columnMeta?.dataType?.toUpperCase() ?? ''
  if (
    normalizedType.includes('DATE') ||
    normalizedType.includes('TIME') ||
    normalizedType.includes('YEAR')
  ) {
    count += 1
  }
  return count
}

const MIN_FIELD_WIDTH = 120
const MARKER_SLOT_WIDTH = 32
const MARKER_GAP_WIDTH = 4

function getExpandedEditorWidth(targetWidth: number, markerCount: number): number {
  if (markerCount <= 0) {
    return targetWidth
  }

  const markerWidth =
    markerCount * MARKER_SLOT_WIDTH + Math.max(0, markerCount - 1) * MARKER_GAP_WIDTH
  const ratioWidth = Math.ceil(markerWidth * 3)
  const contentWidth = Math.max(targetWidth, ratioWidth, MIN_FIELD_WIDTH + markerWidth)

  return contentWidth
}

export function computeRequestedEditorWidth(targetWidth: number, markerCount: number): number {
  return getExpandedEditorWidth(targetWidth, markerCount)
}

export function wrapEditorAsGlideOverlay(
  EditorComponent: VendorNeutralEditorComponent,
  testId?: string
): FunctionComponent<CustomEditorProps> {
  return function GlideOverlayEditor({
    target,
    value,
    onChange,
    onFinishedEditing,
  }: CustomEditorProps) {
    const currentValueRef = useRef(value)
    const close = useCallback(
      (commitChanges?: boolean) => {
        onFinishedEditing(commitChanges === false ? undefined : currentValueRef.current)
      },
      [onFinishedEditing]
    )
    const editorData = extractEditorData(value)
    if (!editorData) return null

    const { row, columnKey, columnMeta, isNullable, foreignKey, selectAllOnFocus } = editorData
    const targetWidth = getEditorTargetWidth(target)
    const expandedWidth = getExpandedEditorWidth(targetWidth, getMarkerCount(editorData, columnMeta))

    return (
      <div
        data-testid={testId ?? 'glide-overlay-editor'}
        data-sqllumen-glide-editor-root="true"
        data-sqllumen-editor-width={String(expandedWidth)}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          width: `${expandedWidth}px`,
          maxWidth: `${expandedWidth}px`,
          minWidth: 0,
          height: '100%',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <EditorComponent
          row={row}
          column={{ key: columnKey }}
          isNullable={isNullable}
          columnMeta={columnMeta}
          foreignKey={foreignKey}
          selectAllOnFocus={selectAllOnFocus}
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
      </div>
    )
  }
}

const wrappedNullableEditor = wrapEditorAsGlideOverlay(NullableCellEditor, 'glide-text-editor')
const wrappedEnumEditor = wrapEditorAsGlideOverlay(EnumCellEditor, 'glide-enum-editor')
const wrappedDateTimeEditor = wrapEditorAsGlideOverlay(
  DateTimeCellEditor as VendorNeutralEditorComponent,
  'glide-datetime-editor'
)

export function getGlideEditor(
  _column: GridColumn<unknown>,
  editorType: GridEditorType
): ProvideEditorCallbackResult<GridCell> | null {
  if (editorType === 'none') return null

  const editorByType: Partial<Record<GridEditorType, FunctionComponent<CustomEditorProps>>> = {
    enum: wrappedEnumEditor,
    datetime: wrappedDateTimeEditor,
    text: wrappedNullableEditor,
    fk: wrappedNullableEditor,
  }

  const editor = editorByType[editorType] ?? wrappedNullableEditor

  return {
    editor,
  }
}
