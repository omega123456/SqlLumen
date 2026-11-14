import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { useQueryStore } from '../../../stores/query-store'
import { columnKey, columnIndexFromKey } from '../../../lib/col-key-utils'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import type { ColumnMeta } from '../../../types/schema'
import type { CellClickGuardArgs } from '../../../types/shared-data-view'
import type { GridCellPosition } from '../../shared/glide/glide-grid-types'
import type { GridRowSource } from '../../shared/glide/grid-row-source'
import type { ResultRow } from '../../../lib/result-row-materializer'

const READ_ONLY_SELECTION_SYNC_DELAY_MS = 75

interface CellSelection {
  rowIdx: number
  columnKey: string
  value: unknown
}

export interface ResultSelectionSyncInputs {
  tabId: string
  queryId: string | null
  viewVersion: number
  columns: ColumnMeta[]
  onRowSelected: (rowIndex: number) => void
  rowSourceRef: RefObject<GridRowSource<ResultRow>>
}

function isSameSelection(lastSelection: CellSelection | null, nextSelection: CellSelection) {
  return (
    lastSelection?.rowIdx === nextSelection.rowIdx &&
    lastSelection.columnKey === nextSelection.columnKey &&
    Object.is(lastSelection.value, nextSelection.value)
  )
}

function clearTimer(timerRef: RefObject<ReturnType<typeof setTimeout> | null>) {
  if (!timerRef.current) return
  clearTimeout(timerRef.current)
  timerRef.current = null
}

function useSelectionSync({ tabId, columns, onRowSelected }: ResultSelectionSyncInputs) {
  const storeSetSelectedCell = useQueryStore((state) => state.setSelectedCell)
  const lastSyncedSelectionRef = useRef<CellSelection | null>(null)

  const syncSelection = useCallback(
    (rowIndex: number, selectedColumnKey: string, selectedRow: Record<string, unknown>) => {
      const nextSelection = {
        rowIdx: rowIndex,
        columnKey: selectedColumnKey,
        value: selectedRow[selectedColumnKey],
      }
      if (isSameSelection(lastSyncedSelectionRef.current, nextSelection)) return
      lastSyncedSelectionRef.current = nextSelection
      onRowSelected(rowIndex)
      const column = columns[columnIndexFromKey(selectedColumnKey)]
      if (!column) return
      storeSetSelectedCell(tabId, { columnKey: column.name, value: nextSelection.value })
    },
    [columns, onRowSelected, storeSetSelectedCell, tabId]
  )

  return { syncSelection, lastSyncedSelectionRef }
}

function useDeferredReadOnlySelection(inputs: ResultSelectionSyncInputs) {
  const { tabId } = inputs
  const storeSetSelectedCell = useQueryStore((state) => state.setSelectedCell)
  const columnsRef = useLatestRef(inputs.columns)
  const onRowSelectedRef = useLatestRef(inputs.onRowSelected)
  const storeSetSelectedCellRef = useLatestRef(storeSetSelectedCell)
  const pendingSelectionRef = useRef<CellSelection | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushPendingSelection = useCallback(() => {
    timerRef.current = null
    const pendingSelection = pendingSelectionRef.current
    if (!pendingSelection) return
    pendingSelectionRef.current = null
    const column = columnsRef.current[columnIndexFromKey(pendingSelection.columnKey)]
    onRowSelectedRef.current(pendingSelection.rowIdx)
    if (!column) return
    storeSetSelectedCellRef.current(tabId, {
      columnKey: column.name,
      value: pendingSelection.value,
    })
  }, [tabId, columnsRef, onRowSelectedRef, storeSetSelectedCellRef])

  const handleCellSelectionChange = useCallback(
    (args: CellClickGuardArgs) => {
      pendingSelectionRef.current = {
        rowIdx: args.rowIdx,
        columnKey: args.columnKey,
        value: args.rowData[args.columnKey],
      }
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flushPendingSelection, READ_ONLY_SELECTION_SYNC_DELAY_MS)
    },
    [flushPendingSelection]
  )

  useEffect(() => () => clearTimer(timerRef), [])

  return { handleCellSelectionChange, pendingSelectionRef, timerRef, columnsRef }
}

export function useResultSelectionSync(inputs: ResultSelectionSyncInputs) {
  const { tabId, queryId, viewVersion, columns, rowSourceRef } = inputs
  const { syncSelection, lastSyncedSelectionRef } = useSelectionSync(inputs)
  const deferred = useDeferredReadOnlySelection(inputs)
  const { pendingSelectionRef, timerRef, columnsRef } = deferred

  useEffect(() => {
    lastSyncedSelectionRef.current = null
    pendingSelectionRef.current = null
    clearTimer(timerRef)
  }, [queryId, viewVersion, columns, tabId, lastSyncedSelectionRef, pendingSelectionRef, timerRef])

  const handleSelectedCellChange = useCallback(
    (position: GridCellPosition) => {
      const row = rowSourceRef.current.getRow(position.rowIdx)
      const column = columnsRef.current[position.idx]
      if (!row) return
      if (!column) return
      syncSelection(position.rowIdx, columnKey(position.idx), row)
    },
    [syncSelection, rowSourceRef, columnsRef]
  )

  return {
    syncSelection: syncSelection,
    handleCellSelectionChange: deferred.handleCellSelectionChange,
    handleSelectedCellChange: handleSelectedCellChange,
    columnsRef: columnsRef,
  }
}
