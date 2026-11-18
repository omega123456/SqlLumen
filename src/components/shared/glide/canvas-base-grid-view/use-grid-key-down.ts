import { useCallback, useEffect } from 'react'
import type { GridCellPosition } from '../glide-grid-types'
import { isInteractiveElement } from '../../../../lib/input-events'
import type { GlideKeyDownEvent } from './canvas-grid-types'
import { isTypingActivationKey } from './grid-cell-editing'
import { isEditableListColumn, isForeignKeyLookupColumn } from './grid-columns'
import {
  cancelGlideKey,
  currentSelectionCell,
  isShortcutKey,
  resolveFocusedCell,
  resolveKeyboardCell,
} from './grid-selection-helpers'
import type { GridSelectionModel, GridViewModel } from './grid-view-model'
import type { SelectionMove } from './use-grid-keyboard-selection'
import type { TypingActivationHandler } from './use-grid-typing-editor'

type PreventableEvent = { preventDefault: () => void }
type ForeignKeyLookupTrigger = (event: PreventableEvent) => boolean

export interface GridKeyDownActions {
  moveSelectionVertically: SelectionMove
  moveSelectionHorizontally: SelectionMove
  handleTypingActivation: TypingActivationHandler
  copySelectionToClipboard: () => Promise<void>
  cutSelectionToClipboard: () => Promise<void>
  openListEditor: (cell: GridCellPosition) => void
}

interface GridKeyDownInput {
  model: GridViewModel
  selection: GridSelectionModel
  actions: GridKeyDownActions
}

const FOREIGN_KEY_LOOKUP_KEY = 'F4'
const TAB_KEY = 'Tab'
const SHIFT_TAB_KEY = 'Shift+Tab'

function selectionMoveKeyName(event: GlideKeyDownEvent): string {
  const isShiftTab = event.key === TAB_KEY && event.shiftKey
  return isShiftTab ? SHIFT_TAB_KEY : event.key
}

function useForeignKeyLookupFromSelection(input: GridKeyDownInput): ForeignKeyLookupTrigger {
  const { gridColumns, source } = input.model
  const { selectedCellPosition, onFkCellAction } = input.model.props
  const { lastInteractedCellRef } = input.model.refs.selection
  const gridSelectionCell = currentSelectionCell(input.selection.gridSelection)
  return useCallback(
    (event: PreventableEvent) => {
      const position = resolveFocusedCell({
        selectedCell: selectedCellPosition,
        selectionCell: gridSelectionCell,
        lastInteractedCell: lastInteractedCellRef.current,
      })
      if (!position) return false
      const row = source.getRow(position.rowIdx)
      const column = gridColumns[position.idx]
      if (!row) return false
      if (!isForeignKeyLookupColumn(column)) return false
      event.preventDefault()
      void onFkCellAction?.({
        rowIdx: position.rowIdx,
        columnKey: column.key,
        rowData: row,
        source: 'keyboard',
      })
      return true
    },
    [
      gridColumns,
      gridSelectionCell,
      lastInteractedCellRef,
      onFkCellAction,
      source,
      selectedCellPosition,
    ]
  )
}

function usePendingActionKey(input: GridKeyDownInput) {
  const { isWindowed } = input.model
  const { actionPendingRef, actionAbortRef } = input.model.refs.action
  const { copySelectionToClipboard, cutSelectionToClipboard } = input.actions
  return useCallback(
    (event: GlideKeyDownEvent): boolean => {
      const isCancellingPendingAction = event.key === 'Escape' && actionPendingRef.current
      if (isCancellingPendingAction) {
        cancelGlideKey(event)
        actionAbortRef.current?.abort()
        return true
      }
      const isWindowedCopy = isWindowed && isShortcutKey(event, 'c')
      if (isWindowedCopy) {
        cancelGlideKey(event)
        void copySelectionToClipboard()
        return true
      }
      if (!isShortcutKey(event, 'x')) return false
      cancelGlideKey(event)
      void cutSelectionToClipboard()
      return true
    },
    [
      actionAbortRef,
      actionPendingRef,
      copySelectionToClipboard,
      cutSelectionToClipboard,
      isWindowed,
    ]
  )
}

function useEnterKey(input: GridKeyDownInput) {
  const { gridColumns, source } = input.model
  const { isEditMode, editableColumnKeys, onRowDoubleClicked } = input.model.props
  const { activeSelectedRowIndex } = input.selection
  const { openListEditor } = input.actions
  return useCallback(
    (event: GlideKeyDownEvent, currentCell: GridCellPosition | null) => {
      const currentColumn = currentCell ? gridColumns[currentCell.idx] : undefined
      const isListEditorTarget = isEditableListColumn(currentColumn, isEditMode, editableColumnKeys)
      if (currentCell && isListEditorTarget) {
        cancelGlideKey(event)
        openListEditor(currentCell)
        return
      }
      if (activeSelectedRowIndex == null) return
      const row = source.getRow(activeSelectedRowIndex)
      if (!row) return
      event.preventDefault()
      onRowDoubleClicked?.(row)
    },
    [
      activeSelectedRowIndex,
      editableColumnKeys,
      gridColumns,
      isEditMode,
      onRowDoubleClicked,
      openListEditor,
      source,
    ]
  )
}

function useDocumentGridKeys(input: GridKeyDownInput, triggerLookup: ForeignKeyLookupTrigger) {
  const { gridColumns } = input.model
  const { isActive } = input.model.flags
  const { selectedCellPosition, isEditMode, editableColumnKeys } = input.model.props
  const { lastInteractedCellRef } = input.model.refs.selection
  const { gridSelection } = input.selection
  const { openListEditor } = input.actions
  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (!isActive) return
      if (isInteractiveElement(event.target)) return
      const documentCell = resolveFocusedCell({
        selectedCell: selectedCellPosition,
        selectionCell: currentSelectionCell(gridSelection),
        lastInteractedCell: lastInteractedCellRef.current,
      })
      const column = documentCell ? gridColumns[documentCell.idx] : undefined
      const opensListEditor =
        event.key === 'Enter' && isEditableListColumn(column, isEditMode, editableColumnKeys)
      if (documentCell && opensListEditor) {
        event.preventDefault()
        openListEditor(documentCell)
        return
      }
      if (event.defaultPrevented) return
      if (event.key !== FOREIGN_KEY_LOOKUP_KEY) return
      triggerLookup(event)
    }
    document.addEventListener('keydown', handleDocumentKeyDown)
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown)
    }
  }, [
    editableColumnKeys,
    gridColumns,
    gridSelection,
    isActive,
    isEditMode,
    lastInteractedCellRef,
    openListEditor,
    selectedCellPosition,
    triggerLookup,
  ])
}

export function useGridKeyDown(input: GridKeyDownInput) {
  const { rowCount } = input.model
  const { isActive } = input.model.flags
  const { selectedCellPosition } = input.model.props
  const { moveSelectionVertically, moveSelectionHorizontally, handleTypingActivation } =
    input.actions
  const gridSelectionCell = currentSelectionCell(input.selection.gridSelection)
  const triggerForeignKeyLookup = useForeignKeyLookupFromSelection(input)
  const handlePendingActionKey = usePendingActionKey(input)
  const handleEnterKey = useEnterKey(input)
  useDocumentGridKeys(input, triggerForeignKeyLookup)

  return useCallback<(event: GlideKeyDownEvent) => void>(
    (event) => {
      if (rowCount === 0) return
      if (handlePendingActionKey(event)) return
      const currentCell = resolveKeyboardCell(gridSelectionCell, selectedCellPosition)
      const selectionMovesByKey: Record<string, () => void> = {
        ArrowDown: () => moveSelectionVertically(1, currentCell),
        ArrowUp: () => moveSelectionVertically(-1, currentCell),
        ArrowRight: () => moveSelectionHorizontally(1, currentCell),
        ArrowLeft: () => moveSelectionHorizontally(-1, currentCell),
        [TAB_KEY]: () => moveSelectionHorizontally(1, currentCell),
        [SHIFT_TAB_KEY]: () => moveSelectionHorizontally(-1, currentCell),
      }
      const moveSelectionByKey = selectionMovesByKey[selectionMoveKeyName(event)]
      if (moveSelectionByKey) {
        cancelGlideKey(event)
        moveSelectionByKey()
        return
      }
      const isTypingIntoCell = isTypingActivationKey(event) && currentCell !== null
      if (isTypingIntoCell) {
        handleTypingActivation(event, currentCell)
        return
      }
      if (event.key === 'Enter') {
        handleEnterKey(event, currentCell)
        return
      }
      const isForeignKeyLookupKey = event.key === FOREIGN_KEY_LOOKUP_KEY
      if (!isActive) return
      if (!isForeignKeyLookupKey) return
      event.cancel?.()
      triggerForeignKeyLookup(event)
    },
    [
      gridSelectionCell,
      handleEnterKey,
      handlePendingActionKey,
      handleTypingActivation,
      isActive,
      moveSelectionHorizontally,
      moveSelectionVertically,
      rowCount,
      selectedCellPosition,
      triggerForeignKeyLookup,
    ]
  )
}
