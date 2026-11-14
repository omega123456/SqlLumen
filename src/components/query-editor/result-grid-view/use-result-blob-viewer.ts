import { useCallback, useState } from 'react'
import { columnIndexFromKey } from '../../../lib/col-key-utils'
import { toCachedRow } from '../../../lib/result-row-materializer'
import type { BlobEnvelope, ColumnMeta } from '../../../types/schema'
import type { GridColumnDescriptor } from '../../../types/shared-data-view'
import { rowPositionOf, type GridBlobContext } from './result-grid-model'

interface ResultBlobViewerInputs {
  columns: ColumnMeta[]
  gridColumns: GridColumnDescriptor[]
  editingRowIndex: number | null
  onStartEditing: (rowIndex: number, row: GridBlobContext['row']) => void
  onSyncCellValue: (columnIndex: number, value: unknown) => void
}

function mustStartEditingBlobRow(context: GridBlobContext, editingRowIndex: number | null) {
  return context.rowIndex >= 0 && editingRowIndex !== context.rowIndex
}

export function useResultBlobViewer(inputs: ResultBlobViewerInputs) {
  const { columns, gridColumns, editingRowIndex, onStartEditing, onSyncCellValue } = inputs
  const [blobContext, setBlobContext] = useState<GridBlobContext | null>(null)

  const closeBlobDialog = useCallback(() => {
    setBlobContext(null)
  }, [])

  const handleCellDoubleClick = useCallback(
    (row: Record<string, unknown>, clickedColumnKey: string) => {
      const columnIndex = columnIndexFromKey(clickedColumnKey)
      const column = columns[columnIndex]
      const descriptor = gridColumns[columnIndex]
      if (!column) return
      if (!descriptor?.isBinary) return
      const cellValue = row[clickedColumnKey]
      setBlobContext({
        rowIndex: rowPositionOf(row),
        row: toCachedRow(row, columns.length),
        columnIndex: columnIndex,
        columnLabel: column.name,
        base64: typeof cellValue === 'string' ? cellValue : null,
        editable: descriptor.blobViewerEditable === true,
      })
    },
    [columns, gridColumns]
  )

  const handleBlobApply = useCallback(
    (envelope: BlobEnvelope) => {
      if (!blobContext?.editable) return
      if (mustStartEditingBlobRow(blobContext, editingRowIndex)) {
        onStartEditing(blobContext.rowIndex, blobContext.row)
      }
      onSyncCellValue(blobContext.columnIndex, envelope)
    },
    [blobContext, editingRowIndex, onStartEditing, onSyncCellValue]
  )

  return { blobContext, closeBlobDialog, handleCellDoubleClick, handleBlobApply }
}
