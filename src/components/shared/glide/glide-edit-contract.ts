export type EditActivationSource = 'click' | 'dblclick' | 'enter' | 'tab' | 'keyboard-char'

export interface EditEligibilityCheck {
  isEditable: boolean
  requiresAutosaveGuard: boolean
  editorType: 'text' | 'enum' | 'set' | 'datetime' | 'fk' | 'json' | 'none'
}

export type EditLifecycleEvent =
  | { type: 'preview'; rowIdx: number; columnKey: string; value: string | null }
  | {
      type: 'commit'
      rowIdx: number
      columnKey: string
      value: string | null
      source: 'enter' | 'tab' | 'blur'
    }
  | { type: 'cancel'; rowIdx: number; columnKey: string }
  | { type: 'autosave-guard-needed'; fromRowIdx: number; toRowIdx: number }
  | { type: 'focus-restore'; rowIdx: number; columnKey: string }

export type ClipboardAction =
  | { type: 'copy'; cells: Array<{ rowIdx: number; columnKey: string; value: string }> }
  | { type: 'cut'; cells: Array<{ rowIdx: number; columnKey: string }> }
  | { type: 'paste'; cells: Array<{ rowIdx: number; columnKey: string; value: string | null }> }

export const EDIT_CONTRACT_NATIVE_GLIDE_FEATURES: string[] = [
  'onCellEdited can deliver committed cell values from overlay editors',
  'onRowAppended can request creation of a new row',
  'getCellsForSelection can provide copy payloads for native clipboard support',
  'onPaste can receive pasted tabular text for adapter parsing',
  'onDelete can represent cut/delete clearing behavior',
]

export const EDIT_CONTRACT_GAPS: string[] = [
  'Preview-before-commit semantics require adapter-owned transient state.',
  'Autosave guard timing for row switches must be coordinated with feature stores.',
  'FK lookup editors need custom overlay behavior beyond native text editing.',
]
