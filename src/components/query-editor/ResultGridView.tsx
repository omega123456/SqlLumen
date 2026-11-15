import { EditorCallbacksContext } from '../shared/editor-callbacks-context'
import { FkLookupProvider } from '../shared/fk-lookup-context'
import { BlobViewerTargetDialog } from '../shared/data-view/BlobViewerTargetDialog'
import { ForeignKeyLookupTargetDialog } from '../shared/data-view/ForeignKeyLookupTargetDialog'
import { CanvasBaseGridView } from '../shared/glide/CanvasBaseGridView'
import type { ResultGridViewProps } from './result-grid-view/result-grid-model'
import { useResultGridViewModel } from './result-grid-view/use-result-grid-view-model'

export function ResultGridView(props: ResultGridViewProps) {
  const { gridRef, gridProps, editorCallbacksContext, foreignKeyLookup, blobViewer } =
    useResultGridViewModel(props)
  return (
    <EditorCallbacksContext.Provider value={editorCallbacksContext}>
      <FkLookupProvider onFkLookup={foreignKeyLookup.openLookup}>
        <CanvasBaseGridView ref={gridRef} {...gridProps} />
        <ForeignKeyLookupTargetDialog
          lookup={foreignKeyLookup}
          location={props.editLocation ?? null}
        />
        <BlobViewerTargetDialog viewer={blobViewer} />
      </FkLookupProvider>
    </EditorCallbacksContext.Provider>
  )
}
