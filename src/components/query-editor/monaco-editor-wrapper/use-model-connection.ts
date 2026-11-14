import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type * as MonacoType from 'monaco-editor'
import { registerModelConnection, unregisterModelConnection } from '../completion-service'
import type { TabType } from '../../../types/schema'

export interface ModelConnectionTarget {
  connectionId: string | undefined
  tabId: string
  tabType: TabType
}

function registerIfConnected(target: ModelConnectionTarget, modelUri: string | undefined) {
  if (!target.connectionId) return
  if (!modelUri) return
  registerModelConnection({
    uri: modelUri,
    connectionId: target.connectionId,
    tabId: target.tabId,
    tabType: target.tabType,
  })
}

function unregisterCapturedModel(modelUriRef: RefObject<string | undefined>): void {
  if (modelUriRef.current) unregisterModelConnection(modelUriRef.current)
}

export function useModelConnection(
  target: ModelConnectionTarget,
  editorRef: RefObject<MonacoType.editor.IStandaloneCodeEditor | null>
) {
  const { connectionId, tabId, tabType } = target
  const modelUriRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const unregisterOnCleanup = () => unregisterCapturedModel(modelUriRef)
    if (!editorRef.current) return unregisterOnCleanup
    registerIfConnected({ connectionId, tabId, tabType }, modelUriRef.current)
    return unregisterOnCleanup
  }, [connectionId, tabId, tabType, editorRef])

  const captureModelOnMount = useCallback(
    (editor: MonacoType.editor.IStandaloneCodeEditor) => {
      modelUriRef.current = editor.getModel()?.uri.toString()
      registerIfConnected({ connectionId, tabId, tabType }, modelUriRef.current)
    },
    [connectionId, tabId, tabType]
  )

  const releaseModelOnDispose = useCallback(() => unregisterCapturedModel(modelUriRef), [])

  return { captureModelOnMount, releaseModelOnDispose }
}
