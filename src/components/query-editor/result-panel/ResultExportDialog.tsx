import { useQueryStore } from '../../../stores/query-store'
import ExportDialog from '../../dialogs/ExportDialog'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'

interface ResultExportDialogProps {
  surfaceRef: DataViewSurfaceRef
  connectionId: string
  isOpen: boolean
}

export function ResultExportDialog({ surfaceRef, connectionId, isOpen }: ResultExportDialogProps) {
  const closeExportDialog = useQueryStore((state) => state.closeExportDialog)
  if (!isOpen) return null
  return (
    <ExportDialog
      connectionId={connectionId}
      tabId={surfaceRef.tabId}
      resultIndex={surfaceRef.resultIndex}
      onClose={() => closeExportDialog(surfaceRef)}
    />
  )
}
