import { EditorCallbacksContext } from '../shared/editor-callbacks-context'
import { CanvasBaseGridView } from '../shared/glide/CanvasBaseGridView'
import { QueryResultBlobDialog } from './QueryResultBlobDialog'
import type { ResultGridViewProps } from './result-grid-view/result-grid-model'
import { useResultGridViewModel } from './result-grid-view/use-result-grid-view-model'

export function ResultGridView(props: ResultGridViewProps) {
  const { gridProps, editorCallbacksContext, blobViewer } = useResultGridViewModel(props)
  return (
    <EditorCallbacksContext.Provider value={editorCallbacksContext}>
      <CanvasBaseGridView {...gridProps} />
      <QueryResultBlobDialog
        blobContext={blobViewer.blobContext}
        onClose={blobViewer.closeBlobDialog}
        onApply={blobViewer.handleBlobApply}
      />
    </EditorCallbacksContext.Provider>
  )
}
