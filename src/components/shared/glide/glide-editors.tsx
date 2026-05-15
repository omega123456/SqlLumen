import { useCallback, useEffect, useRef, type ComponentType, type FunctionComponent } from 'react'
import {
  GridCellKind,
  type GridCell,
  type Rectangle,
  type TextCell,
  type ProvideEditorCallbackResult,
} from '@glideapps/glide-data-grid'
import type { GridColumn } from './glide-grid-types'
import DateTimeCellEditor from '../../table-data/DateTimeCellEditor'
import { NullableCellEditor, type CellEditorBaseProps } from '../grid-cell-editors'
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
  columnLabel?: string
  columnMeta?: CellEditorBaseProps['columnMeta']
  isNullable: boolean
  foreignKey?: CellEditorBaseProps['foreignKey']
  initialInputValue?: string
  cancelRestoreValue?: unknown
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

interface GlideOverlayConfig {
  testId?: string
  reserveMarkerWidth?: boolean
  overlayExtraWidth?: number
}

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
  config: GlideOverlayConfig = {}
): FunctionComponent<CustomEditorProps> {
  return function GlideOverlayEditor({
    target,
    value,
    onChange,
    onFinishedEditing,
  }: CustomEditorProps) {
    const {
      testId,
      reserveMarkerWidth = true,
      overlayExtraWidth = 20,
    } = config
    const currentValueRef = useRef(value)
    const close = useCallback(
      (commitChanges?: boolean) => {
        onFinishedEditing(commitChanges === false ? undefined : currentValueRef.current)
      },
      [onFinishedEditing]
    )
    const editorData = extractEditorData(value)
    if (!editorData) return null

    const {
      row,
      columnKey,
      columnLabel,
      columnMeta,
      isNullable,
      foreignKey,
      initialInputValue,
      cancelRestoreValue,
      selectAllOnFocus,
    } = editorData
    const targetWidth = getEditorTargetWidth(target)
    const markerCount = reserveMarkerWidth ? getMarkerCount(editorData, columnMeta) : 0
    const expandedWidth = getExpandedEditorWidth(targetWidth, markerCount)
    const requestedOverlayWidth = expandedWidth + overlayExtraWidth

    useEffect(() => {
      if (initialInputValue == null) {
        currentValueRef.current = value
        return
      }

      const seededCell = {
        ...(value as TextCell),
        data: initialInputValue,
        displayData: initialInputValue,
        copyData: initialInputValue,
      }
      currentValueRef.current = seededCell
    }, [initialInputValue, value])

    return (
      <div
        data-testid={testId ?? 'glide-overlay-editor'}
        data-sqllumen-glide-editor-root="true"
        data-sqllumen-editor-width={String(requestedOverlayWidth)}
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
          column={{ key: columnLabel ?? columnKey }}
          isNullable={isNullable}
          columnMeta={columnMeta}
          foreignKey={foreignKey}
          initialInputValue={initialInputValue}
          {...(Object.prototype.hasOwnProperty.call(editorData, 'cancelRestoreValue')
            ? { cancelRestoreValue }
            : {})}
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

const wrappedNullableEditor = wrapEditorAsGlideOverlay(NullableCellEditor, {
  testId: 'glide-text-editor',
})
const wrappedDateTimeEditor = wrapEditorAsGlideOverlay(
  DateTimeCellEditor as VendorNeutralEditorComponent,
  {
    testId: 'glide-datetime-editor',
  }
)

export function getGlideEditor(
  _column: GridColumn<unknown>,
  editorType: GridEditorType
): ProvideEditorCallbackResult<GridCell> | null {
  if (editorType === 'none') return null
  if (editorType === 'enum') return null

  const editorByType: Partial<Record<GridEditorType, FunctionComponent<CustomEditorProps>>> = {
    datetime: wrappedDateTimeEditor,
    text: wrappedNullableEditor,
    fk: wrappedNullableEditor,
  }

  const editor = editorByType[editorType] ?? wrappedNullableEditor

  return {
    editor,
  }
}
