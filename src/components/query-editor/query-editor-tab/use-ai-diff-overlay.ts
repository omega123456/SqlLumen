import { useCallback, useState, type RefObject } from 'react'
import type * as MonacoType from 'monaco-editor'
import { useAiStore } from '../../../stores/ai-store'
import { useRegisterAiDiffHandler } from '../ai-diff-bridge-context'
import {
  buildDiffState,
  applyDiff,
  restoreTabAfterDiff,
  DIFF_OVERLAY_INITIAL,
} from '../diff-overlay-utils'
import type { DiffOverlayState, PlainRange } from '../diff-overlay-utils'

type EditorRef = RefObject<MonacoType.editor.IStandaloneCodeEditor | null>

export function useAiDiffOverlay(tabId: string, editorRef: EditorRef) {
  const [diffOverlayState, setDiffOverlayState] = useState<DiffOverlayState>(DIFF_OVERLAY_INITIAL)

  const handleTriggerDiff = useCallback(
    (proposedSql: string, range: PlainRange) => {
      const result = buildDiffState(editorRef.current, proposedSql, range)
      if (!result) return
      setDiffOverlayState(result)
      useAiStore.getState().setAiReviewing(tabId)
    },
    [tabId, editorRef]
  )

  useRegisterAiDiffHandler(tabId, handleTriggerDiff)

  const closeDiffOverlay = useCallback(() => {
    setDiffOverlayState(DIFF_OVERLAY_INITIAL)
    restoreTabAfterDiff(tabId)
  }, [tabId])

  const handleDiffAccept = useCallback(
    (finalSql: string) => {
      const applied = applyDiff({
        editor: editorRef.current,
        state: diffOverlayState,
        finalSql: finalSql,
        tabId: tabId,
      })
      if (applied) closeDiffOverlay()
    },
    [diffOverlayState, tabId, editorRef, closeDiffOverlay]
  )

  return {
    diffOverlayState: diffOverlayState,
    handleDiffAccept: handleDiffAccept,
    handleDiffReject: closeDiffOverlay,
  }
}
