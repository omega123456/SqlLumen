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
import { LineChange, applyHunkToOriginal } from './diff-overlay-utils'
export type { LineChange }
import { useThemeStore } from '../../stores/theme-store'
import { getMonacoThemeName } from '../../lib/monaco-theme'
import { Button } from '../common/Button'
import styles from './DiffOverlay.module.css'

const HUNK_ZONE_ORDINAL_BASE = 500_000

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

  const modifiedEditor = diffEditor.getModifiedEditor?.()
  if (modifiedEditor && typeof modifiedEditor.changeViewZones === 'function') {
    modifiedEditor.changeViewZones((accessor) => {
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
  dom.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
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
        position: { lineNumber: lineNumber, column: 1 },
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
  const theme = useThemeStore((state) => state.theme)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
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
      const modifiedModel = monaco.editor.createModel(proposedSql, 'sql')

      originalModelRef.current = origModel
      modifiedModelRef.current = modifiedModel
      diffEditorRef.current = editor

      editor.setModel({ original: origModel, modified: modifiedModel })

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
    [originalSql, proposedSql]
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
        const modifiedEditor = diffEditor.getModifiedEditor()
        if (typeof modifiedEditor.removeContentWidget === 'function') {
          for (const widget of acceptWidgetsRef.current) {
            modifiedEditor.removeContentWidget(widget)
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
    const modifiedModel = modifiedModelRef.current
    if (!origModel || !modifiedModel) {
      return
    }

    applyHunkToOriginal(change, origModel, modifiedModel)
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
    const modifiedModel = modifiedModelRef.current
    if (!diffEditor || !modifiedModel) {
      return
    }

    const origEd = diffEditor.getOriginalEditor?.()
    const modifiedEditor = diffEditor.getModifiedEditor?.()
    if (!origEd || typeof origEd.changeViewZones !== 'function') {
      return
    }
    if (!modifiedEditor || typeof modifiedEditor.changeViewZones !== 'function') {
      return
    }

    for (const widget of acceptWidgetsRef.current) {
      if (typeof modifiedEditor.removeContentWidget === 'function') {
        modifiedEditor.removeContentWidget(widget)
      }
    }
    acceptWidgetsRef.current = []

    removeAllHunkViewZones(diffEditor, hunkZoneIdsRef)

    type EligibleHunk = { index: number; change: LineChange }
    const eligible: EligibleHunk[] = []
    for (let index = 0; index < lineChanges.length; index++) {
      const change = lineChanges[index]
      const modifiedLine = change.modifiedStartLineNumber
      if (modifiedLine < 1 || modifiedLine > modifiedModel.getLineCount()) {
        continue
      }
      eligible.push({ index: index, change: change })
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
            ordinal: HUNK_ZONE_ORDINAL_BASE + index,
          })
        )
      }
    })

    const nextModifiedZoneIds: string[] = []
    modifiedEditor.changeViewZones((modifiedAccessor) => {
      for (const { index, change } of eligible) {
        const modifiedSpacer = document.createElement('div')
        modifiedSpacer.className = styles.hunkSpacerRow
        modifiedSpacer.setAttribute('aria-hidden', 'true')

        nextModifiedZoneIds.push(
          modifiedAccessor.addZone({
            afterLineNumber: modifiedViewZoneAfterLine(change),
            heightInLines: 1,
            domNode: modifiedSpacer,
            suppressMouseDown: true,
            ordinal: HUNK_ZONE_ORDINAL_BASE + index,
          })
        )
      }
    })

    hunkZoneIdsRef.current = { orig: nextOrig, mod: nextModifiedZoneIds }

    if (typeof modifiedEditor.addContentWidget === 'function') {
      for (const { index, change } of eligible) {
        const widget = createAcceptHunkContentWidget({
          id: `ai-diff-accept-hunk-${index}`,
          testId: `hunk-accept-inline-${index}`,
          change: change,
          modifiedModel: modifiedModel,
          inlineClassName: styles.inlineAccept,
          onAccept: () => {
            handleAcceptHunk(change)
          },
        })
        modifiedEditor.addContentWidget(widget)
        acceptWidgetsRef.current.push(widget)
      }
    }

    return () => {
      for (const widget of acceptWidgetsRef.current) {
        if (typeof modifiedEditor.removeContentWidget === 'function') {
          modifiedEditor.removeContentWidget(widget)
        }
      }
      acceptWidgetsRef.current = []
      removeAllHunkViewZones(diffEditor, hunkZoneIdsRef)
    }
  }, [lineChanges, handleAcceptHunk])

  /**
   * Accept all — apply the final SQL to the main editor.
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

  /**
   * Close — if any per-hunk accepts were applied in the overlay, persist the
   * merged left-pane SQL to the main editor (same payload as Accept all in
   * that state). Otherwise dismiss without changing the query tab.
   */
  const handleClose = useCallback(() => {
    if (hunksAccepted && originalModelRef.current) {
      onAccept(originalModelRef.current.getValue())
    } else {
      onReject()
    }
  }, [onAccept, onReject, hunksAccepted])

  const closeLabel = hunksAccepted
    ? 'Apply accepted changes and close review'
    : 'Close review without updating the query'

  return (
    <div className={styles.overlay} data-testid="diff-overlay">
      <div className={styles.header}>
        <span className={styles.title}>Review changes</span>
        <div className={styles.actions}>
          <Button variant="danger" size="sm" onClick={onReject} data-testid="diff-reject-button">
            Reject all
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={handleAcceptAll}
            data-testid="diff-accept-all-button"
          >
            Accept all
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
      <div className={styles.footer}>
        <div className={styles.actions}>
          <Button
            size="sm"
            onClick={handleClose}
            title={closeLabel}
            aria-label={closeLabel}
            data-testid="diff-close-button"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
