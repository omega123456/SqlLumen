import { memo } from 'react'
import { EditorCallbacksContext } from '../editor-callbacks-context'
import { FkLookupProvider } from '../fk-lookup-context'
import { CanvasBaseGridView } from '../glide/CanvasBaseGridView'
import { BlobViewerTargetDialog } from './BlobViewerTargetDialog'
import { ForeignKeyLookupTargetDialog } from './ForeignKeyLookupTargetDialog'
import type { DataViewSource } from './data-view-source'
import { useDataGridViewModel } from './grid/use-data-grid-view-model'

export interface DataGridViewProps {
  source: DataViewSource
}

export const DataGridView = memo(function DataGridView({ source }: DataGridViewProps) {
  const { gridRef, gridProps, editorCallbacksContext, foreignKeyLookup, blobViewer, editLocation } =
    useDataGridViewModel(source)
  return (
    <EditorCallbacksContext.Provider value={editorCallbacksContext}>
      <FkLookupProvider onFkLookup={foreignKeyLookup.openLookup}>
        <CanvasBaseGridView ref={gridRef} {...gridProps} />
        <ForeignKeyLookupTargetDialog lookup={foreignKeyLookup} location={editLocation} />
        <BlobViewerTargetDialog viewer={blobViewer} />
      </FkLookupProvider>
    </EditorCallbacksContext.Provider>
  )
})
