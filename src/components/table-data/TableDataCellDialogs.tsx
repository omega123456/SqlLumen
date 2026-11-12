import { FkLookupDialog } from './FkLookupDialog'
import { BlobViewerDialog } from '../dialogs/BlobViewerDialog'
import type { ForeignKeyLookupTarget } from './use-fk-lookup-flow'
import type { BlobViewerState } from './use-blob-viewer-state'

export interface TableLocation {
  connectionId: string
  database: string
  table: string
}

export interface ForeignKeyLookupTargetDialogProps {
  target: ForeignKeyLookupTarget
  tableLocation: TableLocation
  isReadOnly: boolean
  onClose: () => void
  onApply: (selectedValue: unknown) => void
}

export function ForeignKeyLookupTargetDialog({
  target,
  tableLocation,
  isReadOnly,
  onClose,
  onApply,
}: ForeignKeyLookupTargetDialogProps) {
  return (
    <FkLookupDialog
      isOpen={true}
      onClose={onClose}
      onApply={onApply}
      connectionId={tableLocation.connectionId}
      database={target.foreignKey.referencedDatabase || tableLocation.database}
      sourceTable={tableLocation.table}
      sourceColumn={target.columnKey}
      currentValue={target.currentValue}
      referencedTable={target.foreignKey.referencedTable}
      referencedColumn={target.foreignKey.referencedColumn}
      isReadOnly={isReadOnly}
    />
  )
}

export interface BlobViewerTargetDialogProps {
  viewer: BlobViewerState
}

export function BlobViewerTargetDialog({ viewer }: BlobViewerTargetDialogProps) {
  if (!viewer.blobViewerTarget) {
    return null
  }
  return (
    <BlobViewerDialog
      isOpen={true}
      onClose={viewer.closeBlobViewer}
      mode="edit"
      columnLabel={viewer.blobViewerTarget.columnKey}
      loader={viewer.loadBlob}
      onApply={viewer.applyBlob}
    />
  )
}
