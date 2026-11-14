import { CanvasBaseGridView } from '../shared/glide/CanvasBaseGridView'
import { EditorCallbacksContext } from '../shared/editor-callbacks-context'
import { FkLookupProvider } from '../shared/fk-lookup-context'
import { BlobViewerTargetDialog, ForeignKeyLookupTargetDialog } from './TableDataCellDialogs'
import {
  useTableGridViewModel,
  type TableDataGridProps,
} from './table-data-grid/use-table-grid-view-model'

export function TableDataGrid(props: TableDataGridProps) {
  const {
    gridRef,
    gridProps,
    editorCallbacksContext,
    foreignKeys,
    blobViewer,
    canEditRows,
    tabState,
  } = useTableGridViewModel(props)
  const { foreignKeyLookupTarget } = foreignKeys
  return (
    <EditorCallbacksContext.Provider value={editorCallbacksContext}>
      <FkLookupProvider onFkLookup={foreignKeys.handleForeignKeyLookup}>
        <CanvasBaseGridView ref={gridRef} {...gridProps} />
        {foreignKeyLookupTarget && (
          <ForeignKeyLookupTargetDialog
            target={foreignKeyLookupTarget}
            tableLocation={tabState}
            isReadOnly={!canEditRows}
            onClose={foreignKeys.handleForeignKeyLookupClose}
            onApply={foreignKeys.handleForeignKeyApply}
          />
        )}
        <BlobViewerTargetDialog viewer={blobViewer} />
      </FkLookupProvider>
    </EditorCallbacksContext.Provider>
  )
}
