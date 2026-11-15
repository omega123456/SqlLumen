import { useCallback, useState } from 'react'
import type { BlobEnvelope } from '../../../types/schema'
import type { GridColumnDescriptor } from '../../../types/shared-data-view'
import {
  startEditingIfNeeded,
  type BlobContent,
  type CellTarget,
  type GridRowData,
  type RowEditSession,
} from './row-edit-session'

export interface BlobViewerTarget<RowIdentity> {
  cell: CellTarget<RowIdentity>
  columnLabel: string
  isEditable: boolean
  content: BlobContent
}

export interface BlobViewerInputs<RowIdentity> {
  session: RowEditSession<RowIdentity>
  columns: GridColumnDescriptor[]
}

export interface BlobViewer<RowIdentity> {
  target: BlobViewerTarget<RowIdentity> | null
  openBlobViewer: (rowData: GridRowData, columnKey: string) => void
  openFormFieldBlob: (column: GridColumnDescriptor, rowData: GridRowData | null) => void
  closeBlobViewer: () => void
  applyBlob: (envelope: BlobEnvelope) => void
}

function blobTargetOf<RowIdentity>(
  inputs: BlobViewerInputs<RowIdentity>,
  rowData: GridRowData,
  columnKey: string
): BlobViewerTarget<RowIdentity> | null {
  const { session, columns } = inputs
  const column = columns.find((candidate) => candidate.key === columnKey)
  if (!column?.blobViewer) return null
  const identity = session.identityOf(rowData)
  const cell = {
    identity: identity,
    rowIndex: session.rowIndexOf(identity),
    rowData: rowData,
    columnKey: columnKey,
  }
  const content = session.blobContentFor(cell)
  if (!content) return null
  return {
    cell: cell,
    columnLabel: column.displayName,
    isEditable: column.blobViewerEditable === true,
    content: content,
  }
}

export function useBlobViewer<RowIdentity>(
  inputs: BlobViewerInputs<RowIdentity>
): BlobViewer<RowIdentity> {
  const { session, columns } = inputs
  const [target, setTarget] = useState<BlobViewerTarget<RowIdentity> | null>(null)

  const openBlobViewer = useCallback(
    (rowData: GridRowData, columnKey: string) => {
      const nextTarget = blobTargetOf({ session, columns }, rowData, columnKey)
      if (nextTarget) setTarget(nextTarget)
    },
    [columns, session]
  )
  const openFormFieldBlob = useCallback(
    (column: GridColumnDescriptor, rowData: GridRowData | null) => {
      if (rowData) openBlobViewer(rowData, column.key)
    },
    [openBlobViewer]
  )
  const closeBlobViewer = useCallback(() => setTarget(null), [])
  const applyBlob = useCallback(
    (envelope: BlobEnvelope) => {
      if (!target?.isEditable) return
      startEditingIfNeeded(session, target.cell.identity, target.cell.rowData)
      session.commitCellValue(target.cell, envelope)
    },
    [session, target]
  )

  return {
    target: target,
    openBlobViewer: openBlobViewer,
    openFormFieldBlob: openFormFieldBlob,
    closeBlobViewer: closeBlobViewer,
    applyBlob: applyBlob,
  }
}
