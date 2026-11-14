import { useEffect, useRef, type RefObject } from 'react'
import { useTableDataStore } from '../../../stores/table-data-store'
import type { GridHandle } from '../../shared/glide/glide-grid-types'
import type { GridColumnDescriptor } from '../../../types/shared-data-view'
import {
  draftTempIdOf,
  findRowIndexByKey,
  type RowKey,
  type TableDataRow,
  type TableEditState,
} from './table-data-grid-model'

interface DraftAutoselectInputs {
  gridRef: RefObject<GridHandle | null>
  editState: TableEditState
  rowCount: number
  selectedRowKey: RowKey | null
}

export function useDraftRowAutoselect(inputs: DraftAutoselectInputs) {
  const { gridRef, editState, rowCount, selectedRowKey } = inputs
  const autoSelectedDraftTempIdRef = useRef<string | null>(null)
  const isNewRow = editState?.isNewRow
  const tempId = editState?.tempId
  useEffect(() => {
    if (!isNewRow) {
      autoSelectedDraftTempIdRef.current = null
      return
    }
    const isDraftSelected = draftTempIdOf(selectedRowKey) === tempId
    if (!isDraftSelected) return
    if (rowCount === 0) return
    if (autoSelectedDraftTempIdRef.current === tempId) return
    const draftRowIndex = rowCount - 1
    autoSelectedDraftTempIdRef.current = tempId ?? null
    requestAnimationFrame(() => {
      gridRef.current?.selectCell({ rowIdx: draftRowIndex, idx: 0 }, { shouldFocusCell: true })
    })
  }, [isNewRow, tempId, rowCount, selectedRowKey, gridRef])
}

export interface ColumnJumpInputs {
  tabId: string
  gridRef: RefObject<GridHandle | null>
  descriptorColumns: GridColumnDescriptor[]
  rowData: TableDataRow[]
  primaryKeyColumns: string[]
  selectedRowKey: RowKey | null
}

function jumpRowOf(
  rowData: TableDataRow[],
  selectedRowKey: RowKey | null,
  primaryKeyColumns: string[]
): TableDataRow | undefined {
  if (!selectedRowKey) return undefined
  return rowData[findRowIndexByKey(rowData, selectedRowKey, primaryKeyColumns)]
}

export function useColumnJump(inputs: ColumnJumpInputs) {
  const { tabId, gridRef, descriptorColumns, rowData, primaryKeyColumns, selectedRowKey } = inputs
  const columnJumpRequest = useTableDataStore((state) => state.columnJumpRequests[tabId])
  const selectedCell = useTableDataStore((state) => state.tabs[tabId]?.selectedCell)
  const consumeColumnJump = useTableDataStore((state) => state.consumeColumnJump)
  const setSelectedCell = useTableDataStore((state) => state.setSelectedCell)
  useEffect(() => {
    if (!columnJumpRequest) return
    const targetColumnKey = columnJumpRequest.columnKey
    const index = descriptorColumns.findIndex((column) => column.key === targetColumnKey)
    if (index < 0) return
    const jumpRow = jumpRowOf(rowData, selectedRowKey, primaryKeyColumns)
    const movesSelectedCell =
      selectedCell != null && jumpRow !== undefined && selectedCell.columnKey !== targetColumnKey
    if (movesSelectedCell) {
      setSelectedCell(tabId, { columnKey: targetColumnKey, value: jumpRow[targetColumnKey] })
      consumeColumnJump(tabId)
      return
    }
    gridRef.current?.scrollToCell({ idx: index }, 'horizontal')
    consumeColumnJump(tabId)
  }, [
    columnJumpRequest,
    consumeColumnJump,
    descriptorColumns,
    gridRef,
    primaryKeyColumns,
    rowData,
    selectedRowKey,
    selectedCell,
    setSelectedCell,
    tabId,
  ])
}
