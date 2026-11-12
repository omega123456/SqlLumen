import { BlobViewerDialog } from '../dialogs/BlobViewerDialog'
import type { BlobEnvelope } from '../../types/schema'

export interface QueryResultBlobContext {
  columnLabel: string
  base64: string | null
  editable: boolean
}

interface QueryResultBlobDialogProps {
  blobContext: QueryResultBlobContext | null
  onClose: () => void
  onApply: (envelope: BlobEnvelope) => void
}

export function QueryResultBlobDialog({
  blobContext,
  onClose,
  onApply,
}: QueryResultBlobDialogProps) {
  if (!blobContext) return null
  return (
    <BlobViewerDialog
      isOpen={true}
      onClose={onClose}
      mode={blobContext.editable ? 'edit' : 'view'}
      columnLabel={blobContext.columnLabel}
      initialBase64={blobContext.base64}
      onApply={blobContext.editable ? onApply : undefined}
    />
  )
}
