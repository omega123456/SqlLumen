import { useCallback } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { LineChange } from './diff-overlay-utils'
import { useDiffEditorModels } from './diff-overlay/use-diff-editor-models'
import { useHunkAcceptWidgets } from './diff-overlay/use-hunk-accept-widgets'
export type { LineChange }
import { useThemeStore } from '../../stores/theme-store'
import { getMonacoThemeName } from '../../lib/monaco-theme'
import { DiffOverlayFooter, DiffOverlayHeader } from './diff-overlay/DiffOverlayChrome'

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

export function DiffOverlay({
  originalSql,
  proposedSql,
  onAccept,
  onReject,
}: DiffOverlayProps): React.JSX.Element {
  const theme = useThemeStore((state) => state.theme)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const monacoThemeName = getMonacoThemeName(theme, resolvedTheme === 'dark')

  const { refs, lineChanges, hunksAccepted, handleMount, handleAcceptHunk } = useDiffEditorModels(
    originalSql,
    proposedSql
  )
  useHunkAcceptWidgets({ refs: refs, lineChanges: lineChanges, onAcceptHunk: handleAcceptHunk })
  const { originalModelRef } = refs

  const finishWithMergedSql = useCallback(
    (whenNothingAccepted: () => void) => {
      const mergedModel = hunksAccepted ? originalModelRef.current : null
      if (mergedModel) {
        onAccept(mergedModel.getValue())
        return
      }
      whenNothingAccepted()
    },
    [hunksAccepted, onAccept, originalModelRef]
  )
  const handleAcceptAll = useCallback(
    () => finishWithMergedSql(() => onAccept(proposedSql)),
    [finishWithMergedSql, onAccept, proposedSql]
  )
  const handleClose = useCallback(
    () => finishWithMergedSql(onReject),
    [finishWithMergedSql, onReject]
  )

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col overflow-hidden rounded-overlay bg-light-surface-container shadow-light-flyout dark:bg-dark-surface-container dark:shadow-dark-flyout"
      data-testid="diff-overlay"
    >
      <DiffOverlayHeader onReject={onReject} onAcceptAll={handleAcceptAll} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
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
      <DiffOverlayFooter hunksAccepted={hunksAccepted} onClose={handleClose} />
    </div>
  )
}
