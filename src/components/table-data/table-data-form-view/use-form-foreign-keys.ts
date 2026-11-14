import { useCallback, useEffect } from 'react'
import { useTableDataStore, isEditingRowKey } from '../../../stores/table-data-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { isUnchangedForeignKeySelection } from '../../../lib/foreign-key-utils'
import type { FkLookupArgs } from '../../shared/fk-lookup-context'
import { useFkLookupFlow, type ForeignKeyLookupTarget } from '../use-fk-lookup-flow'
import type { FormRecordInputs } from './use-form-record-actions'

interface FormForeignKeyInputs extends FormRecordInputs {
  isActive: boolean
  ensureEditingCurrentRow: () => void
}

function useOpenFormLookup(inputs: FormForeignKeyInputs, openLookup: (args: FkLookupArgs) => void) {
  const { tabId, isActive } = inputs
  const { currentRowKey } = inputs.record
  const { editState } = inputs.view
  const saveCurrentRow = useTableDataStore((state) => state.saveCurrentRow)
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  return useCallback(
    async (args: FkLookupArgs) => {
      if (!isActive) return
      if (!currentRowKey) return
      const isEditingAnotherRow = Boolean(editState) && !isEditingRowKey(editState, currentRowKey)
      if (isEditingAnotherRow) {
        await saveCurrentRow(tabId)
        const refreshedState = useTableDataStore.getState().tabs[tabId]
        if (refreshedState?.saveError) return
      }
      setSelectedRow(tabId, currentRowKey)
      openLookup(args)
    },
    [isActive, currentRowKey, editState, saveCurrentRow, tabId, setSelectedRow, openLookup]
  )
}

function useApplyFormLookup(
  inputs: FormForeignKeyInputs,
  target: ForeignKeyLookupTarget | null,
  closeLookup: () => void
) {
  const { tabId, ensureEditingCurrentRow } = inputs
  const { currentRowKey, currentRowData } = inputs.record
  const updateCellValue = useTableDataStore((state) => state.updateCellValue)
  return useCallback(
    (selectedValue: unknown) => {
      if (!target) return
      if (!currentRowKey) return
      if (!currentRowData) return
      const currentEdit = useTableDataStore.getState().tabs[tabId]?.editState
      const alreadyEditing = isEditingRowKey(currentEdit, currentRowKey)
      const isUnchangedSelection = isUnchangedForeignKeySelection({
        selectedValue: selectedValue,
        currentValue: target.currentValue,
        rowEditState: alreadyEditing ? currentEdit : null,
      })
      if (!isUnchangedSelection) {
        if (!alreadyEditing) ensureEditingCurrentRow()
        updateCellValue(tabId, target.columnKey, selectedValue)
        useTableDataStore.getState().syncCellValue(tabId, {
          rowData: currentRowData,
          column: target.columnKey,
          value: selectedValue,
          rowKeyOverride: currentRowKey,
        })
      }
      closeLookup()
    },
    [
      target,
      currentRowKey,
      currentRowData,
      tabId,
      ensureEditingCurrentRow,
      updateCellValue,
      closeLookup,
    ]
  )
}

function useLookupSideEffects(
  tabId: string,
  isActive: boolean,
  lookupState: { isOpen: boolean; close: () => void }
) {
  const setBlockingNavigation = useWorkspaceStore((state) => state.setBlockingNavigation)
  const { isOpen, close } = lookupState
  useEffect(() => {
    setBlockingNavigation(tabId, isOpen)
    return () => setBlockingNavigation(tabId, false)
  }, [isOpen, setBlockingNavigation, tabId])
  useEffect(() => {
    if (isActive) return
    queueMicrotask(close)
  }, [close, isActive])
}

export function useFormForeignKeys(inputs: FormForeignKeyInputs) {
  const { foreignKeyLookupTarget, openForeignKeyLookup, closeForeignKeyLookup } = useFkLookupFlow()
  useLookupSideEffects(inputs.tabId, inputs.isActive, {
    isOpen: foreignKeyLookupTarget !== null,
    close: closeForeignKeyLookup,
  })
  return {
    foreignKeyLookupTarget: foreignKeyLookupTarget,
    closeForeignKeyLookup: closeForeignKeyLookup,
    onForeignKeyLookup: useOpenFormLookup(inputs, openForeignKeyLookup),
    onForeignKeyApply: useApplyFormLookup(inputs, foreignKeyLookupTarget, closeForeignKeyLookup),
  }
}
