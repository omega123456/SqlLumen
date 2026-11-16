import { useState, useSyncExternalStore } from 'react'
import type * as MonacoType from 'monaco-editor'
import {
  isSemanticHighlightingApplied,
  onSemanticHighlightingStatusChange,
} from '../semantic-highlighting/semantic-highlighting-status'

type StandaloneEditor = MonacoType.editor.IStandaloneCodeEditor

function isEditorModelHighlighted(editor: StandaloneEditor | null): boolean {
  const model = editor?.getModel()
  if (!model) return false
  return isSemanticHighlightingApplied({
    uri: model.uri.toString(),
    versionId: model.getVersionId(),
  })
}

export function useSemanticHighlightingStatus() {
  const [editor, captureSemanticHighlightingEditor] = useState<StandaloneEditor | null>(null)
  const isSemanticHighlightingReady = useSyncExternalStore(onSemanticHighlightingStatusChange, () =>
    isEditorModelHighlighted(editor)
  )
  return { isSemanticHighlightingReady, captureSemanticHighlightingEditor }
}
