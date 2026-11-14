import { useEffect } from 'react'
import type { LineChange } from '../diff-overlay-utils'
import {
  addAcceptWidgets,
  addHunkSpacerZones,
  eligibleHunks,
  modifiedViewZoneAfterLine,
  originalViewZoneAfterLine,
  removeAcceptWidgets,
  removeAllHunkViewZones,
  supportsViewZones,
} from './diff-hunk-widgets'
import type { DiffEditorRefs } from './use-diff-editor-models'

interface HunkAcceptWidgetInputs {
  refs: DiffEditorRefs
  lineChanges: LineChange[]
  onAcceptHunk: (change: LineChange) => void
}

export function useHunkAcceptWidgets({ refs, lineChanges, onAcceptHunk }: HunkAcceptWidgetInputs) {
  const { diffEditorRef, modifiedModelRef, hunkZoneIdsRef, acceptWidgetsRef } = refs
  useEffect(() => {
    const diffEditor = diffEditorRef.current
    const modifiedModel = modifiedModelRef.current
    if (!diffEditor) return
    if (!modifiedModel) return
    const originalEditor = diffEditor.getOriginalEditor?.()
    const modifiedEditor = diffEditor.getModifiedEditor?.()
    if (!supportsViewZones(originalEditor)) return
    if (!supportsViewZones(modifiedEditor)) return

    removeAcceptWidgets(modifiedEditor, acceptWidgetsRef.current)
    acceptWidgetsRef.current = []
    removeAllHunkViewZones(diffEditor, hunkZoneIdsRef)

    const hunks = eligibleHunks(lineChanges, modifiedModel)
    hunkZoneIdsRef.current = {
      orig: addHunkSpacerZones(originalEditor, {
        hunks: hunks,
        afterLine: originalViewZoneAfterLine,
      }),
      mod: addHunkSpacerZones(modifiedEditor, {
        hunks: hunks,
        afterLine: modifiedViewZoneAfterLine,
      }),
    }
    acceptWidgetsRef.current = addAcceptWidgets(modifiedEditor, {
      hunks: hunks,
      modifiedModel: modifiedModel,
      onAcceptHunk: onAcceptHunk,
    })

    return () => {
      removeAcceptWidgets(modifiedEditor, acceptWidgetsRef.current)
      acceptWidgetsRef.current = []
      removeAllHunkViewZones(diffEditor, hunkZoneIdsRef)
    }
  }, [lineChanges, onAcceptHunk, diffEditorRef, modifiedModelRef, hunkZoneIdsRef, acceptWidgetsRef])
}
