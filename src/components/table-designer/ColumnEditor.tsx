import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import type { DefaultValueModel, TableDesignerColumnDef } from '../../types/schema'
import { useTableDesignerStore, type DesignerFieldEdit } from '../../stores/table-designer-store'
import { Button } from '../common/Button'
import styles from './ColumnEditor.module.css'
import {
  REVERTIBLE_COLUMN_FIELDS,
  cellsInDirection,
  clampSelection,
  editStartKey,
  getSelectionAfterDelete,
  getSelectionAfterReorder,
  isLastEditableCell,
  sameCellsBelow,
  selectionMoves,
  type ActiveCell,
  type RowDrag,
  type SelectionMoves,
  type TraversalDirection,
} from './column-editor-model'
import { ColumnRow, type ColumnRowController, type DefaultCellControls } from './ColumnEditorRow'
import { useColumnRowDrag, type RowMove } from './useColumnRowDrag'

interface ColumnEditorProps {
  tabId: string
}

interface HeaderCell {
  label: string
  centred: boolean
}

const HEADER_CELLS: HeaderCell[] = [
  { label: '#', centred: true },
  { label: 'Name', centred: false },
  { label: 'Type', centred: false },
  { label: 'Length', centred: false },
  { label: 'Signed', centred: false },
  { label: 'Nullable', centred: true },
  { label: 'PK', centred: true },
  { label: 'AI', centred: true },
  { label: 'Default', centred: false },
  { label: 'Comment', centred: false },
  { label: '', centred: false },
]

const GHOST_ROW_LABEL_SPAN = HEADER_CELLS.length - 1

type EditableKeyHandler = (event: ReactKeyboardEvent<HTMLElement>, cell: ActiveCell) => void

function cellSelector(cell: ActiveCell): string {
  return `[data-row-index="${cell.rowIndex}"][data-cell-key="${cell.cellKey}"]`
}

function isDisabledFormControl(element: HTMLElement): boolean {
  const isFormControl =
    element instanceof HTMLInputElement ||
    element instanceof HTMLButtonElement ||
    element instanceof HTMLSelectElement
  return isFormControl && element.disabled
}

function isTextEntryInput(element: HTMLElement): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type !== 'checkbox'
}

function traversalDirection(event: ReactKeyboardEvent<HTMLElement>): TraversalDirection {
  return event.shiftKey ? -1 : 1
}

function openOverrideTrigger(triggerRef: RefObject<HTMLButtonElement | null>) {
  const trigger = triggerRef.current
  if (!trigger) return
  trigger.focus()
  trigger.click()
}

function dragRowHeightStyle(drag: RowDrag | null): CSSProperties | undefined {
  if (!drag) return undefined
  return { '--drag-row-height': `${drag.rowHeight}px` } as CSSProperties
}

interface ColumnEditorToolbarProps {
  moves: SelectionMoves
  onAdd: () => void
  onMove: (direction: TraversalDirection) => void
  onDeleteSelected: () => void
}

function ColumnEditorToolbar({ moves, onAdd, onMove, onDeleteSelected }: ColumnEditorToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <Button size="sm" onClick={onAdd} data-testid="column-editor-add">
        <Plus size={16} weight="regular" />
        <span>Add column</span>
      </Button>
      <Button
        variant="subtle"
        size="sm"
        onClick={() => onMove(-1)}
        disabled={!moves.canMoveUp}
        data-testid="column-editor-move-up"
      >
        <ArrowUp size={16} weight="regular" />
        <span>Move up</span>
      </Button>
      <Button
        variant="subtle"
        size="sm"
        onClick={() => onMove(1)}
        disabled={!moves.canMoveDown}
        data-testid="column-editor-move-down"
      >
        <ArrowDown size={16} weight="regular" />
        <span>Move down</span>
      </Button>
      <span className={styles.toolbarDivider} aria-hidden />
      <Button
        variant="subtle"
        size="sm"
        dangerText
        onClick={onDeleteSelected}
        disabled={!moves.canDelete}
        data-testid="column-editor-delete"
      >
        <Trash size={16} weight="regular" />
        <span>Delete</span>
      </Button>
    </div>
  )
}

function ColumnEditorHead() {
  return (
    <thead className={styles.tableHead}>
      <tr>
        {HEADER_CELLS.map(({ label, centred }, index) => (
          <th
            key={`${label}-${index}`}
            className={`${styles.headerCell} ${centred ? styles.centred : ''}`}
            scope="col"
          >
            {label}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function GhostAddRow({ onAdd }: { onAdd: () => void }) {
  return (
    <tr className={styles.ghostRow} onClick={onAdd} data-testid="column-editor-ghost-add">
      <td className={styles.bodyCell}>+</td>
      <td className={styles.bodyCell} colSpan={GHOST_ROW_LABEL_SPAN}>
        Click to add new column...
      </td>
    </tr>
  )
}

function rowKeyFor(column: TableDesignerColumnDef, columnIndex: number): string {
  return `${column.originalName || 'new'}-${columnIndex}`
}

export function ColumnEditor({ tabId }: ColumnEditorProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const addColumn = useTableDesignerStore((state) => state.addColumn)
  const deleteColumn = useTableDesignerStore((state) => state.deleteColumn)
  const reorderColumn = useTableDesignerStore((state) => state.reorderColumn)
  const updateColumn = useTableDesignerStore((state) => state.updateColumn)

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [defaultModeOverrideIndex, setDefaultModeOverrideIndex] = useState<number | null>(null)
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  const [pendingFocusCell, setPendingFocusCell] = useState<ActiveCell | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const editStartValuesRef = useRef<Record<string, string>>({})
  const defaultOverrideTriggerRef = useRef<HTMLButtonElement | null>(null)
  const defaultCellBlurTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const defaultOverrideOpenedRef = useRef(false)

  const columns = tabState?.currentSchema.columns ?? []
  const columnCount = columns.length
  const effectiveSelectedIndex = clampSelection(selectedIndex, columnCount)
  const moves = selectionMoves(effectiveSelectedIndex, columnCount)

  const reorderRows = ({ from, to }: RowMove) => {
    reorderColumn(tabId, from, to)
    setSelectedIndex((current) => getSelectionAfterReorder(current, from, to))
  }
  const rowDrag = useColumnRowDrag({
    columnCount: columnCount,
    onSelect: setSelectedIndex,
    onReorder: reorderRows,
  })

  const getCellElement = useCallback(
    (cell: ActiveCell) =>
      containerRef.current?.querySelector<HTMLElement>(cellSelector(cell)) ?? null,
    []
  )

  const isCellFocusable = (cell: ActiveCell): boolean => {
    const element = getCellElement(cell)
    if (!element) return false
    return !isDisabledFormControl(element)
  }

  const focusCell = useCallback(
    (target: ActiveCell) => {
      const element = getCellElement(target)
      if (!element) {
        setPendingFocusCell(target)
        return
      }
      element.focus()
      if (isTextEntryInput(element)) {
        element.select()
      }
    },
    [getCellElement]
  )

  const findAdjacentCell = (from: ActiveCell, direction: TraversalDirection) => {
    const candidates = cellsInDirection({
      from: from,
      direction: direction,
      columnCount: columnCount,
    })
    return candidates.find(isCellFocusable) ?? null
  }

  const findSameCellInNextRow = (from: ActiveCell) =>
    sameCellsBelow(from, columnCount).find(isCellFocusable) ?? null

  const rememberEditStart = (cell: ActiveCell, value: string) => {
    editStartValuesRef.current[editStartKey(cell)] = value
  }

  const forgetEditStart = (cell: ActiveCell) => {
    delete editStartValuesRef.current[editStartKey(cell)]
  }

  const clearDefaultCellBlurTimers = () => {
    defaultCellBlurTimersRef.current.forEach(clearTimeout)
    defaultCellBlurTimersRef.current.clear()
  }

  const cancelDefaultCellBlur = (columnIndex: number) => {
    const timer = defaultCellBlurTimersRef.current.get(columnIndex)
    if (timer === undefined) return
    clearTimeout(timer)
    defaultCellBlurTimersRef.current.delete(columnIndex)
  }

  const scheduleDefaultCellBlur = (columnIndex: number) => {
    const timer = setTimeout(() => {
      forgetEditStart({ rowIndex: columnIndex, cellKey: 'default' })
      defaultCellBlurTimersRef.current.delete(columnIndex)
    }, 0)
    defaultCellBlurTimersRef.current.set(columnIndex, timer)
  }

  const captureDefaultBaseline = (columnIndex: number, defaultValue: DefaultValueModel) => {
    cancelDefaultCellBlur(columnIndex)
    const cell: ActiveCell = { rowIndex: columnIndex, cellKey: 'default' }
    const hasNoBaseline = editStartValuesRef.current[editStartKey(cell)] === undefined
    if (hasNoBaseline) {
      rememberEditStart(cell, JSON.stringify(defaultValue))
    }
  }

  const handleOverrideOpenChange = (open: boolean) => {
    if (open) {
      defaultOverrideOpenedRef.current = true
      return
    }
    if (defaultOverrideOpenedRef.current) {
      setDefaultModeOverrideIndex(null)
    }
  }

  const revertEditableField = (cell: ActiveCell) => {
    const originalValue = editStartValuesRef.current[editStartKey(cell)]
    if (originalValue === undefined) return
    const revertField = REVERTIBLE_COLUMN_FIELDS[cell.cellKey]
    if (revertField) {
      updateColumn(tabId, {
        index: cell.rowIndex,
        field: revertField.field,
        value: revertField.parseBaseline(originalValue),
      })
    }
    forgetEditStart(cell)
  }

  const appendColumnAndFocusName = (event: ReactKeyboardEvent<HTMLElement>) => {
    addColumn(tabId)
    event.currentTarget.blur()
    setPendingFocusCell({ rowIndex: columnCount, cellKey: 'name' })
  }

  const handleTabKey: EditableKeyHandler = (event, cell) => {
    event.preventDefault()
    forgetEditStart(cell)
    const nextCell = findAdjacentCell(cell, traversalDirection(event))
    if (nextCell) {
      event.currentTarget.blur()
      focusCell(nextCell)
      return
    }
    const isTabbingPastLastCell = !event.shiftKey && isLastEditableCell(cell, columnCount)
    if (isTabbingPastLastCell) {
      appendColumnAndFocusName(event)
    }
  }

  const handleEnterKey: EditableKeyHandler = (event, cell) => {
    event.preventDefault()
    forgetEditStart(cell)
    event.currentTarget.blur()
    const nextRowCell = findSameCellInNextRow(cell)
    if (nextRowCell) {
      focusCell(nextRowCell)
    }
  }

  const handleEscapeKey: EditableKeyHandler = (event, cell) => {
    event.preventDefault()
    revertEditableField(cell)
    event.currentTarget.blur()
  }

  const editableKeyHandlers: Record<string, EditableKeyHandler> = {
    Tab: handleTabKey,
    Enter: handleEnterKey,
    Escape: handleEscapeKey,
  }

  const handleEditableKeyDown: EditableKeyHandler = (event, cell) => {
    editableKeyHandlers[event.key]?.(event, cell)
  }

  useEffect(() => {
    if (!pendingFocusCell) return
    const handle = requestAnimationFrame(() => {
      focusCell(pendingFocusCell)
      setPendingFocusCell(null)
    })
    return () => cancelAnimationFrame(handle)
  }, [columnCount, focusCell, pendingFocusCell])

  useEffect(() => {
    if (defaultModeOverrideIndex === null) return
    defaultOverrideOpenedRef.current = false
    const handle = requestAnimationFrame(() => openOverrideTrigger(defaultOverrideTriggerRef))
    return () => cancelAnimationFrame(handle)
  }, [defaultModeOverrideIndex])

  useEffect(() => {
    const timers = defaultCellBlurTimersRef.current
    return () => {
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])

  if (!tabState) {
    return null
  }

  const handleAddColumn = () => {
    addColumn(tabId)
    setSelectedIndex(columnCount)
  }

  const handleDeleteAtIndex = (columnIndex: number) => {
    clearDefaultCellBlurTimers()
    deleteColumn(tabId, columnIndex)
    setDefaultModeOverrideIndex((current) => (current === columnIndex ? null : current))
    setSelectedIndex((current) => getSelectionAfterDelete(current, columnIndex))
  }

  const handleDeleteSelected = () => {
    if (effectiveSelectedIndex === null) return
    handleDeleteAtIndex(effectiveSelectedIndex)
  }

  const handleMoveSelected = (direction: TraversalDirection) => {
    if (effectiveSelectedIndex === null) return
    const nextIndex = effectiveSelectedIndex + direction
    reorderColumn(tabId, effectiveSelectedIndex, nextIndex)
    setSelectedIndex(nextIndex)
  }

  const defaultCell: DefaultCellControls = {
    overrideIndex: defaultModeOverrideIndex,
    overrideTriggerRef: defaultOverrideTriggerRef,
    captureBaseline: captureDefaultBaseline,
    scheduleBlur: scheduleDefaultCellBlur,
    openOverride: setDefaultModeOverrideIndex,
    closeOverride: () => setDefaultModeOverrideIndex(null),
    handleOverrideOpenChange: handleOverrideOpenChange,
  }

  const isActiveCell = (cell: ActiveCell) =>
    activeCell?.rowIndex === cell.rowIndex && activeCell?.cellKey === cell.cellKey

  const controller: ColumnRowController = {
    tabId: tabId,
    tabState: tabState,
    updateColumn: (edit: DesignerFieldEdit<TableDesignerColumnDef>) => updateColumn(tabId, edit),
    activateCell: (cell: ActiveCell) => {
      setSelectedIndex(cell.rowIndex)
      setActiveCell(cell)
    },
    focusCellLater: setPendingFocusCell,
    rememberEditStart: rememberEditStart,
    forgetEditStart: forgetEditStart,
    handleEditableKeyDown: handleEditableKeyDown,
    isActiveCell: isActiveCell,
    deleteColumn: handleDeleteAtIndex,
    defaultCell: defaultCell,
  }

  return (
    <div className={styles.container} data-testid="column-editor" ref={containerRef}>
      <ColumnEditorToolbar
        moves={moves}
        onAdd={handleAddColumn}
        onMove={handleMoveSelected}
        onDeleteSelected={handleDeleteSelected}
      />

      <div className={styles.gridCard}>
        <div className={styles.tableScroller} data-testid="column-editor-scroller">
          <table className={styles.table}>
            <ColumnEditorHead />
            <tbody
              className={`${styles.tableBody} ${rowDrag.drag ? styles.dragging : ''}`}
              style={dragRowHeightStyle(rowDrag.drag)}
            >
              {columns.map((column, columnIndex) => (
                <ColumnRow
                  key={rowKeyFor(column, columnIndex)}
                  row={{
                    column: column,
                    columnIndex: columnIndex,
                    isSelected: effectiveSelectedIndex === columnIndex,
                  }}
                  controller={controller}
                  rowDrag={rowDrag}
                />
              ))}
              <GhostAddRow onAdd={handleAddColumn} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
