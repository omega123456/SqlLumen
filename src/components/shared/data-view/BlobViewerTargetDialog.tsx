import { BlobViewerDialog } from '../../dialogs/BlobViewerDialog'
import type { BlobViewer } from './use-blob-viewer'

export interface BlobViewerTargetDialogProps<RowIdentity> {
  viewer: BlobViewer<RowIdentity>
}

export function BlobViewerTargetDialog<RowIdentity>({
  viewer,
}: BlobViewerTargetDialogProps<RowIdentity>) {
  const { target } = viewer
  if (!target) return null
  return (
    <BlobViewerDialog
      isOpen={true}
      onClose={viewer.closeBlobViewer}
      mode={target.isEditable ? 'edit' : 'view'}
      columnLabel={target.columnLabel}
      loader={target.content.loader}
      initialBase64={target.content.initialBase64}
      onApply={target.isEditable ? viewer.applyBlob : undefined}
    />
  )
}
