import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { useQueryStore } from '../../../stores/query-store'
import { columnIndexFromKey } from '../../../lib/col-key-utils'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import type { ColumnMeta } from '../../../types/schema'
import type { CellClickGuardArgs } from '../../../types/shared-data-view'

const READ_ONLY_SELECTION_SYNC_DELAY_MS = 75

interface PendingSelection {
  rowIdx: number
  columnKey: string
  value: unknown
}

export interface DeferredSelectionInputs {
  tabId: string
  queryId: string | null
  viewVersion: number
  columns: ColumnMeta[]
  onRowSelected: (rowIndex: number) => void
}

function clearTimer(timerRef: RefObject<ReturnType<typeof setTimeout> | null>) {
  if (!timerRef.current) return
  clearTimeout(timerRef.current)
  timerRef.current = null
}

export function useDeferredReadOnlySelection(inputs: DeferredSelectionInputs) {
  const { tabId, queryId, viewVersion, columns } = inputs
  const storeSetSelectedCell = useQueryStore((state) => state.setSelectedCell)
  const columnsRef = useLatestRef(inputs.columns)
  const onRowSelectedRef = useLatestRef(inputs.onRowSelected)
  const storeSetSelectedCellRef = useLatestRef(storeSetSelectedCell)
  const pendingSelectionRef = useRef<PendingSelection | null>(null)
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

  useEffect(() => {
    pendingSelectionRef.current = null
    clearTimer(timerRef)
  }, [queryId, viewVersion, columns, tabId])

  useEffect(() => () => clearTimer(timerRef), [])

  return useCallback(
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
}
