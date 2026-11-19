import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { columnIndexFromKey } from '../../../../lib/col-key-utils'
import type { CellClickGuardArgs } from '../../../../types/shared-data-view'
import type { DataViewSlot, DataViewSurfaceRef } from '../../../../stores/data-view/data-view-types'
import { currentView } from '../../../../stores/data-view/use-data-view'
import { setSelectedCell, setSelectedRow } from '../../../../stores/data-view/view-actions'

const READ_ONLY_SELECTION_SYNC_DELAY_MS = 75

interface PendingSelection {
  rowIdx: number
  columnKey: string
  value: unknown
}

function clearTimer(timerRef: RefObject<ReturnType<typeof setTimeout> | null>) {
  if (!timerRef.current) return
  clearTimeout(timerRef.current)
  timerRef.current = null
}

function applySelection(ref: DataViewSurfaceRef, selection: PendingSelection) {
  setSelectedRow(ref, selection.rowIdx)
  const column = currentView(ref).slot.columns[columnIndexFromKey(selection.columnKey)]
  if (!column) return
  setSelectedCell(ref, { columnKey: column.name, value: selection.value })
}

export function useDeferredSelection(ref: DataViewSurfaceRef, slot: DataViewSlot) {
  const pendingSelectionRef = useRef<PendingSelection | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushPendingSelection = useCallback(() => {
    timerRef.current = null
    const pendingSelection = pendingSelectionRef.current
    if (!pendingSelection) return
    pendingSelectionRef.current = null
    applySelection(ref, pendingSelection)
  }, [ref])

  useEffect(() => {
    pendingSelectionRef.current = null
    clearTimer(timerRef)
  }, [ref, slot])

  useEffect(() => () => clearTimer(timerRef), [])

  return useCallback(
    (args: CellClickGuardArgs) => {
      pendingSelectionRef.current = {
        rowIdx: args.rowIdx,
        columnKey: args.columnKey,
        value: args.rowData[args.columnKey],
      }
      clearTimer(timerRef)
      timerRef.current = setTimeout(flushPendingSelection, READ_ONLY_SELECTION_SYNC_DELAY_MS)
    },
    [flushPendingSelection]
  )
}
