import { useCallback, useEffect, useRef, type ComponentType, type FunctionComponent } from 'react'
import {
  GridCellKind,
  type GridCell,
  type Rectangle,
  type TextCell,
  type ProvideEditorCallbackResult,
} from '@glideapps/glide-data-grid'
import { isWrappableTextSqlType } from '../../../lib/grid-column-style'
import type { GridColumn } from './glide-grid-types'
import DateTimeCellEditor from '../../table-data/DateTimeCellEditor'
import JsonCellEditor from '../JsonCellEditor'
import {
  NullableCellEditor,
  NullableMultilineCellEditor,
  type CellEditorBaseProps,
} from '../grid-cell-editors'
import type { GridEditorType } from '../grid-column-editor-utils'
import { isNullish } from '../../../lib/value-checks'

const EDITOR_WIDTH_TO_MARKER_RATIO = 3
const FALLBACK_VIEWPORT_HEIGHT_PX = 800

interface OverlayHeightLimits {
  minimumPx: number
  maximumPx: number
  viewportShare: number
}

const MULTILINE_OVERLAY_HEIGHT: OverlayHeightLimits = {
  minimumPx: 132,
  maximumPx: 500,
  viewportShare: 0.5,
}
const JSON_OVERLAY_HEIGHT: OverlayHeightLimits = {
  minimumPx: 200,
  maximumPx: 400,
  viewportShare: 0.45,
}

function clampOverlayHeight(viewportHeight: number, limits: OverlayHeightLimits): number {
  const preferredHeight = Math.floor(viewportHeight * limits.viewportShare)
  return Math.max(limits.minimumPx, Math.min(limits.maximumPx, preferredHeight))
}

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
  overlayMinWidth?: number
  overlayHeight?: number | ((target: Rectangle) => number)
}

function getEditorTargetWidth(target: Rectangle): number {
  return Math.max(1, Math.floor(target.width))
}

const TEMPORAL_TYPE_MARKERS = ['DATE', 'TIME', 'YEAR']

function getMarkerCount(
  editorData: GlideEditorCellData,
  columnMeta?: CellEditorBaseProps['columnMeta']
): number {
  let count = 0
  if (editorData.isNullable) count += 1
  if (editorData.foreignKey) count += 1
  const normalizedType = columnMeta?.dataType?.toUpperCase() ?? ''
  const hasTemporalPicker = TEMPORAL_TYPE_MARKERS.some((marker) => normalizedType.includes(marker))
  if (hasTemporalPicker) {
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
  const ratioWidth = Math.ceil(markerWidth * EDITOR_WIDTH_TO_MARKER_RATIO)
  const contentWidth = Math.max(targetWidth, ratioWidth, MIN_FIELD_WIDTH + markerWidth)

  return contentWidth
}

export function computeRequestedEditorWidth(targetWidth: number, markerCount: number): number {
  return getExpandedEditorWidth(targetWidth, markerCount)
}

function getViewportHeight(): number {
  if (typeof window === 'undefined') return FALLBACK_VIEWPORT_HEIGHT_PX
  return window.innerHeight > 0 ? window.innerHeight : FALLBACK_VIEWPORT_HEIGHT_PX
}

function getPreferredMultilineOverlayHeight(_: Rectangle): number {
  return clampOverlayHeight(getViewportHeight(), MULTILINE_OVERLAY_HEIGHT)
}

function getPreferredJsonOverlayHeight(_: Rectangle): number {
  return clampOverlayHeight(getViewportHeight(), JSON_OVERLAY_HEIGHT)
}

function applyInitialInputValue(value: GridCell, initialInputValue: string | undefined): GridCell {
  if (isNullish(initialInputValue)) return value
  if (value.kind !== GridCellKind.Text) return value

  return {
    ...value,
    data: initialInputValue,
    displayData: initialInputValue,
    copyData: initialInputValue,
  }
}

type OverlayHeight = GlideOverlayConfig['overlayHeight']

function resolveOverlayHeight(
  overlayHeight: OverlayHeight,
  target: CustomEditorProps['target']
): number | undefined {
  if (typeof overlayHeight === 'function') return overlayHeight(target)
  return overlayHeight
}

function overlaySizeStyle(expandedWidth: number, overlayHeight: number | undefined) {
  const hasFixedHeight = overlayHeight != null
  return {
    width: `${expandedWidth}px`,
    maxWidth: `${expandedWidth}px`,
    minHeight: hasFixedHeight ? `${overlayHeight}px` : undefined,
    height: hasFixedHeight ? `${overlayHeight}px` : '100%',
  }
}

function restoreValueProps(editorData: NonNullable<ReturnType<typeof extractEditorData>>) {
  const hasCancelRestoreValue = Object.prototype.hasOwnProperty.call(
    editorData,
    'cancelRestoreValue'
  )
  if (!hasCancelRestoreValue) return {}
  return { cancelRestoreValue: editorData.cancelRestoreValue }
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
      overlayMinWidth,
      overlayHeight,
    } = config
    const editorData = extractEditorData(value)
    const initialInputValue = editorData?.initialInputValue
    const currentValueRef = useRef(applyInitialInputValue(value, initialInputValue))
    const appliedInitialInputValueRef = useRef(initialInputValue)
    const close = useCallback(
      (commitChanges?: boolean) => {
        onFinishedEditing(commitChanges === false ? undefined : currentValueRef.current)
      },
      [onFinishedEditing]
    )

    useEffect(() => {
      if (initialInputValue == null) {
        currentValueRef.current = value
        appliedInitialInputValueRef.current = undefined
        return
      }

      if (appliedInitialInputValueRef.current !== initialInputValue) {
        currentValueRef.current = applyInitialInputValue(value, initialInputValue)
        appliedInitialInputValueRef.current = initialInputValue
      }
    }, [initialInputValue, value])

    if (!editorData) return null

    const { row, columnKey, columnMeta, isNullable, foreignKey, selectAllOnFocus } = editorData
    const targetWidth = getEditorTargetWidth(target)
    const markerCount = reserveMarkerWidth ? getMarkerCount(editorData, columnMeta) : 0
    const expandedWidth = Math.max(
      overlayMinWidth ?? 0,
      getExpandedEditorWidth(targetWidth, markerCount)
    )
    const requestedOverlayWidth = expandedWidth + overlayExtraWidth
    const resolvedOverlayHeight = resolveOverlayHeight(overlayHeight, target)

    return (
      <div
        data-testid={testId ?? 'glide-overlay-editor'}
        data-sqllumen-glide-editor-root="true"
        data-sqllumen-editor-width={String(requestedOverlayWidth)}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          ...overlaySizeStyle(expandedWidth, resolvedOverlayHeight),
          minWidth: 0,
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
          initialInputValue={initialInputValue}
          {...restoreValueProps(editorData)}
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
const wrappedNullableMultilineEditor = wrapEditorAsGlideOverlay(NullableMultilineCellEditor, {
  testId: 'glide-textarea-editor',
  overlayHeight: getPreferredMultilineOverlayHeight,
})
const wrappedDateTimeEditor = wrapEditorAsGlideOverlay(
  DateTimeCellEditor as VendorNeutralEditorComponent,
  {
    testId: 'glide-datetime-editor',
  }
)
const wrappedJsonEditor = wrapEditorAsGlideOverlay(JsonCellEditor, {
  testId: 'glide-json-editor',
  overlayMinWidth: 380,
  overlayHeight: getPreferredJsonOverlayHeight,
})

function shouldUseMultilineTextEditor(
  column: GridColumn<unknown>,
  editorType: GridEditorType
): boolean {
  const isFreeTextEditor = editorType === 'text' || editorType === 'fk'
  if (!isFreeTextEditor) return false
  const dataType = typeof column.dataType === 'string' ? column.dataType : ''
  return isWrappableTextSqlType(dataType)
}

export function getGlideEditor(
  column: GridColumn<unknown>,
  editorType: GridEditorType
): ProvideEditorCallbackResult<GridCell> | null {
  if (editorType === 'none') return null
  if (editorType === 'enum') return null
  if (editorType === 'set') return null

  if (shouldUseMultilineTextEditor(column, editorType)) {
    return {
      editor: wrappedNullableMultilineEditor,
    }
  }

  const editorByType: Partial<Record<GridEditorType, FunctionComponent<CustomEditorProps>>> = {
    datetime: wrappedDateTimeEditor,
    json: wrappedJsonEditor,
    text: wrappedNullableEditor,
    fk: wrappedNullableEditor,
  }

  const editor = editorByType[editorType] ?? wrappedNullableEditor

  return {
    editor,
  }
}
