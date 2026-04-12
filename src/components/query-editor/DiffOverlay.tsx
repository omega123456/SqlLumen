/**
 * DiffOverlay — Monaco DiffEditor overlay for reviewing AI-proposed SQL changes.
 *
 * Renders a read-only side-by-side diff view comparing the original statement
 * (from the editor) with the AI-proposed replacement.
 *
 * Supports per-hunk acceptance (VS Code merge-conflict style): each changed
 * hunk gets a dedicated empty row above it on both panes (Monaco view zones)
 * so text does not overlap. The "Accept" action is a content widget on the
 * modified editor (Monaco paints content widgets above viewLines), so it stays
 * clickable; view zones alone would sit under the text layer.
 *
 * Models are managed manually to prevent "TextModel got disposed before
 * DiffEditorWidget model got reset" crashes.  The `<DiffEditor>` receives
 * its models via the `onMount` callback rather than the `original` /
 * `modified` string props.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import type { MutableRefObject } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { DiffOnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useThemeStore } from '../../stores/theme-store'
import { getMonacoThemeName } from './monaco-theme'
import { Button } from '../common/Button'
import styles from './DiffOverlay.module.css'

/** Minimal subset of monaco.editor.ILineChange used by hunk logic. */
export interface LineChange {
  originalStartLineNumber: number
  originalEndLineNumber: number
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
}

export interface DiffOverlayProps {
  originalSql: string
  proposedSql: string
  originalRange: {
    startLineNumber: number
    endLineNumber: number
    startColumn: number
    endColumn: number
  }
  onAccept: (finalSql: string) => void
  onReject: () => void
}

/**
 * Apply a single hunk from the modified model into the original model.
 * After applying, the diff editor will update to reflect the remaining differences.
 */
export function applyHunkToOriginal(
  change: LineChange,
  origModel: monaco.editor.ITextModel,
  modModel: monaco.editor.ITextModel
): void {
  const {
    modifiedStartLineNumber,
    modifiedEndLineNumber,
    originalStartLineNumber,
    originalEndLineNumber,
  } = change

  let newText: string
  if (modifiedEndLineNumber === 0) {
    // Pure deletion — remove the original lines entirely
    newText = ''
  } else {
    newText = modModel.getValueInRange({
      startLineNumber: modifiedStartLineNumber,
      startColumn: 1,
      endLineNumber: modifiedEndLineNumber,
      endColumn: modModel.getLineMaxColumn(modifiedEndLineNumber),
    })
  }

  let targetRange: monaco.IRange
  if (originalEndLineNumber === 0) {
    // Pure insertion — insert after originalStartLineNumber
    const lineCount = origModel.getLineCount()
    if (originalStartLineNumber >= lineCount) {
      // Append after last line
      const lastCol = origModel.getLineMaxColumn(lineCount)
      targetRange = {
        startLineNumber: lineCount,
        startColumn: lastCol,
        endLineNumber: lineCount,
        endColumn: lastCol,
      }
      newText = '\n' + newText
    } else {
      // Insert before the next line
      targetRange = {
        startLineNumber: originalStartLineNumber + 1,
        startColumn: 1,
        endLineNumber: originalStartLineNumber + 1,
        endColumn: 1,
      }
      newText = newText + '\n'
    }
  } else if (modifiedEndLineNumber === 0) {
    // Pure deletion — remove original lines including trailing newline
    const lineCount = origModel.getLineCount()
    if (originalEndLineNumber < lineCount) {
      targetRange = {
        startLineNumber: originalStartLineNumber,
        startColumn: 1,
        endLineNumber: originalEndLineNumber + 1,
        endColumn: 1,
      }
    } else if (originalStartLineNumber > 1) {
      // Last lines in file — remove including preceding newline
      const prevLineMaxCol = origModel.getLineMaxColumn(originalStartLineNumber - 1)
      targetRange = {
        startLineNumber: originalStartLineNumber - 1,
        startColumn: prevLineMaxCol,
        endLineNumber: originalEndLineNumber,
        endColumn: origModel.getLineMaxColumn(originalEndLineNumber),
      }
    } else {
      // Entire file content
      targetRange = {
        startLineNumber: originalStartLineNumber,
        startColumn: 1,
        endLineNumber: originalEndLineNumber,
        endColumn: origModel.getLineMaxColumn(originalEndLineNumber),
      }
    }
  } else {
    // Replacement — swap original lines with modified lines
    targetRange = {
      startLineNumber: originalStartLineNumber,
      startColumn: 1,
      endLineNumber: originalEndLineNumber,
      endColumn: origModel.getLineMaxColumn(originalEndLineNumber),
    }
  }

  origModel.pushEditOperations([], [{ range: targetRange, text: newText }], () => null)
}

/** `afterLineNumber` for a view zone directly above the modified hunk’s first line. */
function modifiedViewZoneAfterLine(change: LineChange): number {
  const start = change.modifiedStartLineNumber
  if (start < 1) {
    return 0
  }
  return start - 1
}

/**
 * `afterLineNumber` on the original model so the spacer row aligns with the
 * modified-side Accept row in the side-by-side diff.
 */
function originalViewZoneAfterLine(change: LineChange): number {
  if (change.originalEndLineNumber === 0) {
    return Math.max(0, change.originalStartLineNumber)
  }
  return Math.max(0, change.originalStartLineNumber - 1)
}

function removeAllHunkViewZones(
  diffEditor: monaco.editor.IStandaloneDiffEditor | null,
  zoneIdsRef: MutableRefObject<{ orig: string[]; mod: string[] }>
): void {
  if (!diffEditor) {
    return
  }

  const origEd = diffEditor.getOriginalEditor?.()
  if (origEd && typeof origEd.changeViewZones === 'function') {
    origEd.changeViewZones((accessor) => {
      for (const id of zoneIdsRef.current.orig) {
        accessor.removeZone(id)
      }
    })
  }

  const modEd = diffEditor.getModifiedEditor?.()
  if (modEd && typeof modEd.changeViewZones === 'function') {
    modEd.changeViewZones((accessor) => {
      for (const id of zoneIdsRef.current.mod) {
        accessor.removeZone(id)
      }
    })
  }

  zoneIdsRef.current = { orig: [], mod: [] }
}

function createAcceptHunkContentWidget(options: {
  id: string
  testId: string
  change: LineChange
  modifiedModel: monaco.editor.ITextModel
  inlineClassName: string
  onAccept: () => void
}): monaco.editor.IContentWidget {
  const { id, testId, change, modifiedModel, inlineClassName, onAccept } = options

  const dom = document.createElement('button')
  dom.type = 'button'
  dom.className = inlineClassName
  dom.textContent = 'Accept'
  dom.setAttribute('data-testid', testId)
  dom.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onAccept()
  })

  return {
    allowEditorOverflow: true,
    getId: () => id,
    getDomNode: () => dom,
    getPosition: (): monaco.editor.IContentWidgetPosition | null => {
      const lineNumber = change.modifiedStartLineNumber
      if (lineNumber < 1 || lineNumber > modifiedModel.getLineCount()) {
        return null
      }
      return {
        position: { lineNumber, column: 1 },
        preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
      }
    },
  }
}

export function DiffOverlay({
  originalSql,
  proposedSql,
  onAccept,
  onReject,
}: DiffOverlayProps): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme)
  const monacoThemeName = getMonacoThemeName(theme, resolvedTheme === 'dark')

  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null)
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null)
  const hunkZoneIdsRef = useRef<{ orig: string[]; mod: string[] }>({ orig: [], mod: [] })
  const acceptWidgetsRef = useRef<monaco.editor.IContentWidget[]>([])

  const [lineChanges, setLineChanges] = useState<LineChange[]>([])
  const [hunksAccepted, setHunksAccepted] = useState(false)

  /** Create models and wire them into the diff editor on mount. */
  const handleMount: DiffOnMount = useCallback(
    (editor) => {
      const origModel = monaco.editor.createModel(originalSql, 'sql')
      const modModel = monaco.editor.createModel(proposedSql, 'sql')

      originalModelRef.current = origModel
      modifiedModelRef.current = modModel
      diffEditorRef.current = editor

      editor.setModel({ original: origModel, modified: modModel })

      // Listen for diff computation updates
      if (typeof editor.onDidUpdateDiff === 'function') {
        editor.onDidUpdateDiff(() => {
          setLineChanges((editor.getLineChanges() as LineChange[] | null) ?? [])
        })
      }

      // Capture initial diff if already computed
      if (typeof editor.getLineChanges === 'function') {
        setLineChanges((editor.getLineChanges() as LineChange[] | null) ?? [])
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // Intentionally empty — content is set once at mount, not re-synced.
  )

  /** Keep model content in sync when props change while the overlay stays mounted. */
  useEffect(() => {
    if (originalModelRef.current != null) {
      originalModelRef.current.setValue(originalSql)
    }
    if (modifiedModelRef.current != null) {
      modifiedModelRef.current.setValue(proposedSql)
    }
  }, [originalSql, proposedSql])

  /**
   * Cleanup: detach models from the editor widget BEFORE disposing them so
   * the DiffEditorWidget never sees a disposed model.
   */
  useEffect(() => {
    return () => {
      const diffEditor = diffEditorRef.current
      if (diffEditor && typeof diffEditor.getModifiedEditor === 'function') {
        const modEditor = diffEditor.getModifiedEditor()
        if (typeof modEditor.removeContentWidget === 'function') {
          for (const w of acceptWidgetsRef.current) {
            modEditor.removeContentWidget(w)
          }
        }
      }
      acceptWidgetsRef.current = []

      removeAllHunkViewZones(diffEditor, hunkZoneIdsRef)

      diffEditorRef.current?.setModel(null)
      originalModelRef.current?.dispose()
      modifiedModelRef.current?.dispose()
      diffEditorRef.current = null
      originalModelRef.current = null
      modifiedModelRef.current = null
    }
  }, [])

  /** Apply a single hunk from the modified model into the original. */
  const handleAcceptHunk = useCallback((change: LineChange) => {
    const origModel = originalModelRef.current
    const modModel = modifiedModelRef.current
    if (!origModel || !modModel) {
      return
    }

    applyHunkToOriginal(change, origModel, modModel)
    setHunksAccepted(true)

    // After editing the original model, the diff editor will recompute.
    // Force-read line changes to get immediate UI feedback.
    const editor = diffEditorRef.current
    if (editor && typeof editor.getLineChanges === 'function') {
      // The diff recomputation may be async; the onDidUpdateDiff listener
      // will capture the update, but also set synchronously if available.
      setLineChanges((editor.getLineChanges() as LineChange[] | null) ?? [])
    }
  }, [])

  /**
   * Per-hunk: matching spacer view zones on both sides, then Accept as a
   * content widget on the modified editor (above viewLines so it receives clicks).
   */
  useEffect(() => {
    const diffEditor = diffEditorRef.current
    const modModel = modifiedModelRef.current
    if (!diffEditor || !modModel) {
      return
    }

    const origEd = diffEditor.getOriginalEditor?.()
    const modEd = diffEditor.getModifiedEditor?.()
    if (!origEd || typeof origEd.changeViewZones !== 'function') {
      return
    }
    if (!modEd || typeof modEd.changeViewZones !== 'function') {
      return
    }

    for (const w of acceptWidgetsRef.current) {
      if (typeof modEd.removeContentWidget === 'function') {
        modEd.removeContentWidget(w)
      }
    }
    acceptWidgetsRef.current = []

    removeAllHunkViewZones(diffEditor, hunkZoneIdsRef)

    type EligibleHunk = { index: number; change: LineChange }
    const eligible: EligibleHunk[] = []
    for (let i = 0; i < lineChanges.length; i++) {
      const change = lineChanges[i]
      const modLine = change.modifiedStartLineNumber
      if (modLine < 1 || modLine > modModel.getLineCount()) {
        continue
      }
      eligible.push({ index: i, change })
    }

    const nextOrig: string[] = []
    origEd.changeViewZones((origAccessor) => {
      for (const { index, change } of eligible) {
        const origWrap = document.createElement('div')
        origWrap.className = styles.hunkSpacerRow
        origWrap.setAttribute('aria-hidden', 'true')

        nextOrig.push(
          origAccessor.addZone({
            afterLineNumber: originalViewZoneAfterLine(change),
            heightInLines: 1,
            domNode: origWrap,
            suppressMouseDown: true,
            ordinal: 500_000 + index,
          })
        )
      }
    })

    const nextMod: string[] = []
    modEd.changeViewZones((modAccessor) => {
      for (const { index, change } of eligible) {
        const modWrap = document.createElement('div')
        modWrap.className = styles.hunkSpacerRow
        modWrap.setAttribute('aria-hidden', 'true')

        nextMod.push(
          modAccessor.addZone({
            afterLineNumber: modifiedViewZoneAfterLine(change),
            heightInLines: 1,
            domNode: modWrap,
            suppressMouseDown: true,
            ordinal: 500_000 + index,
          })
        )
      }
    })

    hunkZoneIdsRef.current = { orig: nextOrig, mod: nextMod }

    if (typeof modEd.addContentWidget === 'function') {
      for (const { index, change } of eligible) {
        const widget = createAcceptHunkContentWidget({
          id: `ai-diff-accept-hunk-${index}`,
          testId: `hunk-accept-inline-${index}`,
          change,
          modifiedModel: modModel,
          inlineClassName: styles.inlineAccept,
          onAccept: () => {
            handleAcceptHunk(change)
          },
        })
        modEd.addContentWidget(widget)
        acceptWidgetsRef.current.push(widget)
      }
    }

    return () => {
      for (const w of acceptWidgetsRef.current) {
        if (typeof modEd.removeContentWidget === 'function') {
          modEd.removeContentWidget(w)
        }
      }
      acceptWidgetsRef.current = []
      removeAllHunkViewZones(diffEditor, hunkZoneIdsRef)
    }
  }, [lineChanges, handleAcceptHunk])

  /**
   * Accept All — apply the final SQL to the main editor.
   *
   * If the user accepted individual hunks first, the left-side model
   * (`origModel`) already contains a mix of original + accepted AI changes.
   * In that case we send `origModel.getValue()` so the partial work is
   * preserved.  If no per-hunk accepts were done, we send the full
   * `proposedSql` (i.e. accept every AI change).
   */
  const handleAcceptAll = useCallback(() => {
    if (hunksAccepted && originalModelRef.current) {
      onAccept(originalModelRef.current.getValue())
    } else {
      onAccept(proposedSql)
    }
  }, [onAccept, proposedSql, hunksAccepted])

  return (
    <div className={styles.overlay} data-testid="diff-overlay">
      <div className={styles.header}>
        <span className={styles.title}>Review Changes</span>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onReject} data-testid="diff-reject-button">
            Reject All
          </Button>
          <Button variant="primary" onClick={handleAcceptAll} data-testid="diff-accept-all-button">
            Accept All
          </Button>
        </div>
      </div>
      <div className={styles.editorContainer}>
        <DiffEditor
          height="100%"
          theme={monacoThemeName}
          onMount={handleMount}
          options={{
            readOnly: true,
            originalEditable: false,
            renderSideBySide: true,
            scrollBeyondLastLine: false,
            minimap: { enabled: false },
            overviewRulerLanes: 0,
          }}
        />
      </div>
    </div>
  )
}
