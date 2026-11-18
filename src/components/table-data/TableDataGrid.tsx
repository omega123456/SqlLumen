import { memo } from 'react'
import { CanvasBaseGridView } from '../shared/glide/CanvasBaseGridView'
import { EditorCallbacksContext } from '../shared/editor-callbacks-context'
import { FkLookupProvider } from '../shared/fk-lookup-context'
import { BlobViewerTargetDialog } from '../shared/data-view/BlobViewerTargetDialog'
import { ForeignKeyLookupTargetDialog } from '../shared/data-view/ForeignKeyLookupTargetDialog'
import {
  useTableGridViewModel,
  type TableDataGridProps,
} from './table-data-grid/use-table-grid-view-model'

export const TableDataGrid = memo(function TableDataGrid(props: TableDataGridProps) {
  const { gridRef, gridProps, editorCallbacksContext, foreignKeyLookup, blobViewer, tabState } =
    useTableGridViewModel(props)
  return (
    <EditorCallbacksContext.Provider value={editorCallbacksContext}>
      <FkLookupProvider onFkLookup={foreignKeyLookup.openLookup}>
        <CanvasBaseGridView ref={gridRef} {...gridProps} />
        <ForeignKeyLookupTargetDialog lookup={foreignKeyLookup} location={tabState ?? null} />
        <BlobViewerTargetDialog viewer={blobViewer} />
      </FkLookupProvider>
    </EditorCallbacksContext.Provider>
  )
})
