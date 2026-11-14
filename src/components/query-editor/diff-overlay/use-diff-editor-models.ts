import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { DiffOnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { applyHunkToOriginal, type LineChange } from '../diff-overlay-utils'
import {
  readLineChanges,
  removeAcceptWidgets,
  removeAllHunkViewZones,
  type HunkZoneIds,
} from './diff-hunk-widgets'

export interface DiffEditorRefs {
  diffEditorRef: RefObject<monaco.editor.IStandaloneDiffEditor | null>
  originalModelRef: RefObject<monaco.editor.ITextModel | null>
  modifiedModelRef: RefObject<monaco.editor.ITextModel | null>
  hunkZoneIdsRef: RefObject<HunkZoneIds>
  acceptWidgetsRef: RefObject<monaco.editor.IContentWidget[]>
}

function detachAcceptWidgets(refs: DiffEditorRefs): void {
  const diffEditor = refs.diffEditorRef.current
  if (typeof diffEditor?.getModifiedEditor === 'function') {
    removeAcceptWidgets(diffEditor.getModifiedEditor(), refs.acceptWidgetsRef.current)
  }
  refs.acceptWidgetsRef.current = []
}

function disposeDiffModels(refs: DiffEditorRefs): void {
  detachAcceptWidgets(refs)
  removeAllHunkViewZones(refs.diffEditorRef.current, refs.hunkZoneIdsRef)
  refs.diffEditorRef.current?.setModel(null)
  refs.originalModelRef.current?.dispose()
  refs.modifiedModelRef.current?.dispose()
  refs.diffEditorRef.current = null
  refs.originalModelRef.current = null
  refs.modifiedModelRef.current = null
}

function useDiffEditorRefs(): DiffEditorRefs {
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null)
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null)
  const hunkZoneIdsRef = useRef<HunkZoneIds>({ orig: [], mod: [] })
  const acceptWidgetsRef = useRef<monaco.editor.IContentWidget[]>([])
  return useMemo(
    () => ({ diffEditorRef, originalModelRef, modifiedModelRef, hunkZoneIdsRef, acceptWidgetsRef }),
    []
  )
}

function useSyncModelContent(refs: DiffEditorRefs, originalSql: string, proposedSql: string) {
  const { originalModelRef, modifiedModelRef } = refs
  useEffect(() => {
    originalModelRef.current?.setValue(originalSql)
    modifiedModelRef.current?.setValue(proposedSql)
  }, [originalSql, proposedSql, originalModelRef, modifiedModelRef])
}

export function useDiffEditorModels(originalSql: string, proposedSql: string) {
  const refs = useDiffEditorRefs()
  const { diffEditorRef, originalModelRef, modifiedModelRef } = refs
  const [lineChanges, setLineChanges] = useState<LineChange[]>([])
  const [hunksAccepted, setHunksAccepted] = useState(false)

  const refreshLineChanges = useCallback((editor: monaco.editor.IStandaloneDiffEditor | null) => {
    const changes = readLineChanges(editor)
    if (changes) setLineChanges(changes)
  }, [])

  const handleMount: DiffOnMount = useCallback(
    (editor) => {
      const originalModel = monaco.editor.createModel(originalSql, 'sql')
      const modifiedModel = monaco.editor.createModel(proposedSql, 'sql')
      originalModelRef.current = originalModel
      modifiedModelRef.current = modifiedModel
      diffEditorRef.current = editor
      editor.setModel({ original: originalModel, modified: modifiedModel })
      if (typeof editor.onDidUpdateDiff === 'function') {
        editor.onDidUpdateDiff(() => refreshLineChanges(editor))
      }
      refreshLineChanges(editor)
    },
    [
      originalSql,
      proposedSql,
      originalModelRef,
      modifiedModelRef,
      diffEditorRef,
      refreshLineChanges,
    ]
  )

  useSyncModelContent(refs, originalSql, proposedSql)
  useEffect(() => () => disposeDiffModels(refs), [refs])

  const handleAcceptHunk = useCallback(
    (change: LineChange) => {
      const originalModel = originalModelRef.current
      const modifiedModel = modifiedModelRef.current
      if (!originalModel) return
      if (!modifiedModel) return
      applyHunkToOriginal(change, originalModel, modifiedModel)
      setHunksAccepted(true)
      refreshLineChanges(diffEditorRef.current)
    },
    [originalModelRef, modifiedModelRef, diffEditorRef, refreshLineChanges]
  )

  return { refs, lineChanges, hunksAccepted, handleMount, handleAcceptHunk }
}
