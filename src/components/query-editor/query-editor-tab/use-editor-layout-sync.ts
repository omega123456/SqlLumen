import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type * as MonacoType from 'monaco-editor'
import { useAiStore } from '../../../stores/ai-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { WORKSPACE_LAYOUT_EVENT } from '../../../lib/workspace-layout-events'

type EditorRef = RefObject<MonacoType.editor.IStandaloneCodeEditor | null>

interface EditorTabSurface {
  tabId: string
  isActive: boolean
  editorRef: EditorRef
}

function focusAiChatInput(tabId: string): void {
  const host = document.querySelector<HTMLElement>(
    `[data-testid="workspace-ai-panel-host"][data-tab-id="${tabId}"]`
  )
  host?.querySelector<HTMLElement>('[data-testid="ai-chat-textarea"]')?.focus()
}

function useRelayoutOnWorkspaceChanges({ tabId, isActive, editorRef }: EditorTabSurface) {
  const isPanelOpen = useAiStore((state) => state.tabs[tabId]?.isPanelOpen ?? false)
  useEffect(() => {
    if (!isActive) return
    editorRef.current?.layout()
  }, [isActive, isPanelOpen, editorRef])

  useEffect(() => {
    const onWorkspaceResize = () => {
      if (!isActive) return
      editorRef.current?.layout()
    }
    window.addEventListener(WORKSPACE_LAYOUT_EVENT, onWorkspaceResize)
    return () => {
      window.removeEventListener(WORKSPACE_LAYOUT_EVENT, onWorkspaceResize)
    }
  }, [isActive, editorRef])
}

function useRestoreFocusOnActivation({ tabId, isActive, editorRef }: EditorTabSurface) {
  const lastFocusedSurface = useWorkspaceStore((state) => state.lastFocusedSurfaceByTab[tabId])
  const wasActiveRef = useRef(isActive)
  useEffect(() => {
    if (!isActive) {
      wasActiveRef.current = false
      return
    }
    if (wasActiveRef.current) return
    wasActiveRef.current = true
    if (lastFocusedSurface === 'ai-input') {
      focusAiChatInput(tabId)
      return
    }
    editorRef.current?.focus()
  }, [isActive, lastFocusedSurface, tabId, editorRef])
}

export function useEditorLayoutSync(surface: EditorTabSurface) {
  const { tabId, isActive, editorRef } = surface
  const setLastFocusedSurface = useWorkspaceStore((state) => state.setLastFocusedSurface)

  const handleEditorMount = useCallback(
    (editor: MonacoType.editor.IStandaloneCodeEditor) => {
      editorRef.current = editor
      editor.onDidFocusEditorWidget?.(() => setLastFocusedSurface(tabId, 'editor'))
      if (isActive) editor.focus()
    },
    [isActive, setLastFocusedSurface, tabId, editorRef]
  )

  const handleEditorPanelResize = useCallback(() => {
    if (!isActive) return
    editorRef.current?.layout()
  }, [isActive, editorRef])

  useRelayoutOnWorkspaceChanges(surface)
  useRestoreFocusOnActivation(surface)
  return { handleEditorMount, handleEditorPanelResize }
}
