import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { useTableDataStore, isEditingRowKey } from '../../../stores/table-data-store'
import type { GridHandle, GridCellPosition } from '../../shared/glide/glide-grid-types'
import type { FkLookupArgs } from '../../shared/fk-lookup-context'
import type { CellClickGuardArgs } from '../../../types/shared-data-view'
import { isUnchangedForeignKeySelection } from '../../../lib/foreign-key-utils'
import { useFkLookupFlow, type ForeignKeyLookupTarget } from '../use-fk-lookup-flow'
import { findRowIndexByKey, getRowKey } from './table-data-grid-model'
import type { TableGridGuardInputs } from './use-table-grid-guards'

const FOREIGN_KEY_SHORTCUT_COOLDOWN_MS = 250

function firstIndexOrZero(index: number): number {
  return index >= 0 ? index : 0
}

function useOpenGuardedLookup(
  inputs: TableGridGuardInputs,
  openForeignKeyLookup: (args: FkLookupArgs) => void,
  ignoreShortcutUntilRef: RefObject<number>
) {
  const { tabId, primaryKeyColumns, descriptorColumns, rowDataRef, commit } = inputs
  const { validateAndCommitCurrentEdit } = commit
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  return useCallback(
    async (args: FkLookupArgs) => {
      const isSuppressedPointerLookup =
        args.source === 'grid-pointer' && Date.now() < ignoreShortcutUntilRef.current
      if (isSuppressedPointerLookup) return
      const targetRowKey = getRowKey(args.rowData, primaryKeyColumns)
      const rowIndex = findRowIndexByKey(rowDataRef.current, targetRowKey, primaryKeyColumns)
      const columnIndex = descriptorColumns.findIndex((column) => column.key === args.columnKey)
      const guardResult = await validateAndCommitCurrentEdit({
        targetRowKey: targetRowKey,
        fallbackRowIndex: firstIndexOrZero(rowIndex),
        targetColumnIndex: firstIndexOrZero(columnIndex),
        enableEditorOnRestore: args.source !== 'keyboard',
      })
      if (!guardResult.passed) return
      setSelectedRow(tabId, targetRowKey)
      openForeignKeyLookup(args)
    },
    [
      primaryKeyColumns,
      descriptorColumns,
      rowDataRef,
      validateAndCommitCurrentEdit,
      setSelectedRow,
      tabId,
      openForeignKeyLookup,
      ignoreShortcutUntilRef,
    ]
  )
}

interface ApplyLookupInputs {
  inputs: TableGridGuardInputs
  target: ForeignKeyLookupTarget | null
  closeForeignKeyLookup: () => void
}

function useApplyForeignKey({ inputs, target, closeForeignKeyLookup }: ApplyLookupInputs) {
  const { tabId, primaryKeyColumns, commit } = inputs
  const { ensureRowEditingStarted } = commit
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const storeUpdateCellValue = useTableDataStore((state) => state.updateCellValue)
  return useCallback(
    (selectedValue: unknown) => {
      if (!target) return
      const { columnKey, rowData } = target
      const rowKey = getRowKey(rowData, primaryKeyColumns)
      const currentEditState = useTableDataStore.getState().tabs[tabId]?.editState
      const isAlreadyEditing = isEditingRowKey(currentEditState, rowKey)
      const isUnchangedSelection = isUnchangedForeignKeySelection({
        selectedValue: selectedValue,
        currentValue: target.currentValue,
        rowEditState: isAlreadyEditing ? currentEditState : null,
      })
      if (!isUnchangedSelection) {
        if (!isAlreadyEditing) ensureRowEditingStarted(rowKey, rowData)
        storeUpdateCellValue(tabId, columnKey, selectedValue)
        useTableDataStore.getState().syncCellValue(tabId, {
          rowData: rowData,
          column: columnKey,
          value: selectedValue,
          rowKeyOverride: rowKey,
        })
      }
      setSelectedRow(tabId, rowKey)
      closeForeignKeyLookup()
    },
    [
      target,
      tabId,
      primaryKeyColumns,
      ensureRowEditingStarted,
      storeUpdateCellValue,
      setSelectedRow,
      closeForeignKeyLookup,
    ]
  )
}

function useForeignKeyCellAction(
  inputs: TableGridGuardInputs,
  openLookup: (args: FkLookupArgs) => Promise<void>
) {
  const { descriptorColumns } = inputs
  return useCallback(
    async (args: CellClickGuardArgs) => {
      const descriptor = descriptorColumns.find((column) => column.key === args.columnKey)
      const foreignKey = descriptor?.foreignKey
      if (!foreignKey) return
      await openLookup({
        columnKey: args.columnKey,
        currentValue: args.rowData[args.columnKey],
        foreignKey: foreignKey,
        rowData: args.rowData,
        source: args.source === 'keyboard' ? 'keyboard' : 'grid-pointer',
      })
    },
    [descriptorColumns, openLookup]
  )
}

interface FocusRestoreInputs {
  gridRef: RefObject<GridHandle | null>
  isLookupOpen: boolean
  selectedCellPosition: GridCellPosition | null
  restoreFocusRef: RefObject<boolean>
}

function useRestoreGridFocusAfterLookup(focus: FocusRestoreInputs) {
  const { gridRef, isLookupOpen, selectedCellPosition, restoreFocusRef } = focus
  useLayoutEffect(() => {
    if (isLookupOpen) return
    if (!restoreFocusRef.current) return
    if (!selectedCellPosition) return
    restoreFocusRef.current = false
    gridRef.current?.selectCell(selectedCellPosition, {
      shouldFocusCell: true,
      enableEditor: false,
    })
  }, [isLookupOpen, selectedCellPosition, gridRef, restoreFocusRef])
}

export interface TableGridForeignKeyInputs extends TableGridGuardInputs {
  gridRef: RefObject<GridHandle | null>
  selectedCellPosition: GridCellPosition | null
}

export function useTableGridForeignKeys(inputs: TableGridForeignKeyInputs) {
  const { foreignKeyLookupTarget, openForeignKeyLookup, closeForeignKeyLookup } = useFkLookupFlow()
  const ignoreShortcutUntilRef = useRef(0)
  const restoreFocusRef = useRef(false)
  const openLookup = useOpenGuardedLookup(inputs, openForeignKeyLookup, ignoreShortcutUntilRef)
  useRestoreGridFocusAfterLookup({
    gridRef: inputs.gridRef,
    isLookupOpen: foreignKeyLookupTarget !== null,
    selectedCellPosition: inputs.selectedCellPosition,
    restoreFocusRef: restoreFocusRef,
  })
  const handleForeignKeyLookupClose = () => {
    ignoreShortcutUntilRef.current = Date.now() + FOREIGN_KEY_SHORTCUT_COOLDOWN_MS
    restoreFocusRef.current = true
    closeForeignKeyLookup()
  }
  return {
    foreignKeyLookupTarget: foreignKeyLookupTarget,
    handleForeignKeyLookup: openLookup,
    handleForeignKeyCellAction: useForeignKeyCellAction(inputs, openLookup),
    handleForeignKeyLookupClose: handleForeignKeyLookupClose,
    handleForeignKeyApply: useApplyForeignKey({
      inputs: inputs,
      target: foreignKeyLookupTarget,
      closeForeignKeyLookup: closeForeignKeyLookup,
    }),
  }
}
