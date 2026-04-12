/**
 * DiffOverlay — Monaco DiffEditor overlay for reviewing AI-proposed SQL changes.
 *
 * Renders a read-only side-by-side diff view comparing the original statement
 * (from the editor) with the AI-proposed replacement.
 *
 * Supports per-hunk acceptance (VS Code merge-conflict style): each changed
 * hunk in the diff editor has an inline "Accept" button that applies just
 * that hunk to the original model, leaving remaining changes visible.
 *
 * Models are managed manually to prevent "TextModel got disposed before
 * DiffEditorWidget model got reset" crashes.  The `<DiffEditor>` receives
 * its models via the `onMount` callback rather than the `original` /
 * `modified` string props.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
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

  const [lineChanges, setLineChanges] = useState<LineChange[]>([])
  const [scrollTop, setScrollTop] = useState(0)
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

      // Listen for scroll changes on the modified (right) editor
      if (typeof editor.getModifiedEditor === 'function') {
        const modEditor = editor.getModifiedEditor()
        if (typeof modEditor.onDidScrollChange === 'function') {
          modEditor.onDidScrollChange((e: { scrollTop: number }) => {
            setScrollTop(e.scrollTop)
          })
        }
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
    if (!origModel || !modModel) return

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

  /** Compute pixel top for a hunk button based on line number. */
  const getHunkButtonTop = useCallback(
    (lineNumber: number): number => {
      const editor = diffEditorRef.current
      if (!editor || typeof editor.getModifiedEditor !== 'function') return 0
      const modEditor = editor.getModifiedEditor()
      if (typeof modEditor.getTopForLineNumber !== 'function') return 0
      return modEditor.getTopForLineNumber(lineNumber) - scrollTop
    },
    [scrollTop]
  )

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
        {lineChanges.length > 0 && (
          <div className={styles.hunkButtonsPane} data-testid="hunk-buttons-pane">
            {lineChanges.map((change, i) => {
              const lineNumber = change.modifiedStartLineNumber
              const top = getHunkButtonTop(lineNumber)

              return (
                <button
                  key={`hunk-${i}-${change.modifiedStartLineNumber}-${change.originalStartLineNumber}`}
                  className={styles.hunkAcceptButton}
                  style={{ top }}
                  onClick={() => handleAcceptHunk(change)}
                  data-testid={`hunk-accept-button-${i}`}
                >
                  Accept
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
