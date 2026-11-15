import type { MutableRefObject } from 'react'
import * as monaco from 'monaco-editor'
import type { LineChange } from '../diff-overlay-utils'

const HUNK_ZONE_ORDINAL_BASE = 500_000

const ACCEPT_HUNK_BUTTON_CLASSES =
  'relative z-2 text-size-caption font-regular whitespace-nowrap text-light-on-surface-variant cursor-pointer pointer-events-auto hover:text-light-on-surface hover:underline dark:text-dark-on-surface-variant dark:hover:text-dark-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-light-primary focus-visible:shadow-light-focus-ring dark:focus-visible:outline-dark-primary dark:focus-visible:shadow-dark-focus-ring'

export type CodeEditor = monaco.editor.ICodeEditor
export type HunkZoneIds = { orig: string[]; mod: string[] }

export function modifiedViewZoneAfterLine(change: LineChange): number {
  const start = change.modifiedStartLineNumber
  if (start < 1) {
    return 0
  }
  return start - 1
}

export function originalViewZoneAfterLine(change: LineChange): number {
  if (change.originalEndLineNumber === 0) {
    return Math.max(0, change.originalStartLineNumber)
  }
  return Math.max(0, change.originalStartLineNumber - 1)
}

function removeViewZones(editor: CodeEditor | undefined, zoneIds: string[]): void {
  if (!supportsViewZones(editor)) return
  editor.changeViewZones((accessor) => {
    for (const id of zoneIds) {
      accessor.removeZone(id)
    }
  })
}

export function removeAllHunkViewZones(
  diffEditor: monaco.editor.IStandaloneDiffEditor | null,
  zoneIdsRef: MutableRefObject<HunkZoneIds>
): void {
  if (!diffEditor) return

  removeViewZones(diffEditor.getOriginalEditor?.(), zoneIdsRef.current.orig)
  removeViewZones(diffEditor.getModifiedEditor?.(), zoneIdsRef.current.mod)
  zoneIdsRef.current = { orig: [], mod: [] }
}

export interface EligibleHunk {
  index: number
  change: LineChange
}

function isLineInModel(lineNumber: number, model: monaco.editor.ITextModel): boolean {
  return lineNumber >= 1 && lineNumber <= model.getLineCount()
}

export function supportsViewZones(editor: CodeEditor | undefined): editor is CodeEditor {
  return Boolean(editor) && typeof editor?.changeViewZones === 'function'
}

export function removeAcceptWidgets(
  modifiedEditor: CodeEditor,
  widgets: monaco.editor.IContentWidget[]
): void {
  if (typeof modifiedEditor.removeContentWidget !== 'function') return
  for (const widget of widgets) {
    modifiedEditor.removeContentWidget(widget)
  }
}

export function eligibleHunks(
  lineChanges: LineChange[],
  modifiedModel: monaco.editor.ITextModel
): EligibleHunk[] {
  const eligible: EligibleHunk[] = []
  lineChanges.forEach((change, index) => {
    if (isLineInModel(change.modifiedStartLineNumber, modifiedModel)) {
      eligible.push({ index: index, change: change })
    }
  })
  return eligible
}

interface HunkSpacerPlan {
  hunks: EligibleHunk[]
  afterLine: (change: LineChange) => number
}

export function addHunkSpacerZones(editor: CodeEditor, plan: HunkSpacerPlan): string[] {
  const zoneIds: string[] = []
  editor.changeViewZones((accessor) => {
    for (const { index, change } of plan.hunks) {
      const spacer = document.createElement('div')
      spacer.className = 'box-border h-full pointer-events-none'
      spacer.setAttribute('aria-hidden', 'true')
      zoneIds.push(
        accessor.addZone({
          afterLineNumber: plan.afterLine(change),
          heightInLines: 1,
          domNode: spacer,
          suppressMouseDown: true,
          ordinal: HUNK_ZONE_ORDINAL_BASE + index,
        })
      )
    }
  })
  return zoneIds
}

function createAcceptHunkContentWidget(options: {
  id: string
  testId: string
  change: LineChange
  modifiedModel: monaco.editor.ITextModel
  onAccept: () => void
}): monaco.editor.IContentWidget {
  const { id, testId, change, modifiedModel, onAccept } = options

  const dom = document.createElement('button')
  dom.type = 'button'
  dom.className = ACCEPT_HUNK_BUTTON_CLASSES
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
      if (!isLineInModel(lineNumber, modifiedModel)) {
        return null
      }
      return {
        position: { lineNumber: lineNumber, column: 1 },
        preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
      }
    },
  }
}

export interface AcceptWidgetPlan {
  hunks: EligibleHunk[]
  modifiedModel: monaco.editor.ITextModel
  onAcceptHunk: (change: LineChange) => void
}

export function addAcceptWidgets(
  modifiedEditor: CodeEditor,
  plan: AcceptWidgetPlan
): monaco.editor.IContentWidget[] {
  if (typeof modifiedEditor.addContentWidget !== 'function') return []
  return plan.hunks.map(({ index, change }) => {
    const widget = createAcceptHunkContentWidget({
      id: `ai-diff-accept-hunk-${index}`,
      testId: `hunk-accept-inline-${index}`,
      change: change,
      modifiedModel: plan.modifiedModel,
      onAccept: () => {
        plan.onAcceptHunk(change)
      },
    })
    modifiedEditor.addContentWidget(widget)
    return widget
  })
}

export function readLineChanges(
  editor: monaco.editor.IStandaloneDiffEditor | null | undefined
): LineChange[] | null {
  if (typeof editor?.getLineChanges !== 'function') return null
  return editor.getLineChanges() ?? []
}
