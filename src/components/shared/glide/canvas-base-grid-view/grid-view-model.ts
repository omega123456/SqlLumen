import { useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { GridSelection, Rectangle } from '@glideapps/glide-data-grid'
import type { GridCellPosition, GridColumn, GridHandle } from '../glide-grid-types'
import type { GridRowSource } from '../grid-row-source'
import type {
  CanvasBaseGridViewProps,
  EditorSessionBaseline,
  GridBehaviourFlags,
  GridRow,
  PendingTypingActivation,
  ScrollCell,
} from './canvas-grid-types'

export interface GridScrollRefs {
  lastAppliedInitialScrollRef: RefObject<ScrollCell | null>
  lastReportedScrollCellRef: RefObject<ScrollCell | null>
  pendingInitialScrollRestoreRef: RefObject<ScrollCell | null>
  suppressScrollPersistenceRef: RefObject<boolean>
}

export interface GridEditorRefs {
  isEditingCellRef: RefObject<boolean>
  editorSessionBaselineRef: RefObject<EditorSessionBaseline | null>
  pendingTypingActivationRef: RefObject<PendingTypingActivation | null>
  listEditorOpeningRef: RefObject<boolean>
}

export interface GridSelectionRefs {
  lastInteractedCellRef: RefObject<GridCellPosition | null>
  previousMarkedRowsRef: RefObject<number[]>
  previousMarkedRangesKeyRef: RefObject<string>
  lastSelectedListCellRef: RefObject<GridCellPosition | null>
}

export interface GridActionRefs {
  actionPendingRef: RefObject<boolean>
  actionAbortRef: RefObject<AbortController | null>
  lastVisibleRegionRef: RefObject<Rectangle | null>
}

export interface GridSessionRefs {
  scroll: GridScrollRefs
  editor: GridEditorRefs
  selection: GridSelectionRefs
  action: GridActionRefs
}

export interface GridSelectionModel {
  gridSelection: GridSelection | undefined
  setGridSelection: Dispatch<SetStateAction<GridSelection | undefined>>
  activeGridSelection: GridSelection | undefined
  activeSelectedRowIndex: number | null
  selectRow: (rowIndex: number | null) => void
  changeSelectedCell: (rowIndex: number, columnIndex: number) => Promise<boolean>
}

export interface GridViewModel {
  props: CanvasBaseGridViewProps
  flags: GridBehaviourFlags
  gridRef: RefObject<GridHandle | null>
  refs: GridSessionRefs
  source: GridRowSource<GridRow>
  isWindowed: boolean
  rowCount: number
  gridColumns: GridColumn<GridRow>[]
}

export const NO_MARKED_RANGES_KEY = '[]'

function useGridScrollRefs(): GridScrollRefs {
  const lastAppliedInitialScrollRef = useRef<ScrollCell | null>(null)
  const lastReportedScrollCellRef = useRef<ScrollCell | null>(null)
  const pendingInitialScrollRestoreRef = useRef<ScrollCell | null>(null)
  const suppressScrollPersistenceRef = useRef(false)
  return useMemo(
    () => ({
      lastAppliedInitialScrollRef,
      lastReportedScrollCellRef,
      pendingInitialScrollRestoreRef,
      suppressScrollPersistenceRef,
    }),
    []
  )
}

function useGridEditorRefs(): GridEditorRefs {
  const isEditingCellRef = useRef(false)
  const editorSessionBaselineRef = useRef<EditorSessionBaseline | null>(null)
  const pendingTypingActivationRef = useRef<PendingTypingActivation | null>(null)
  const listEditorOpeningRef = useRef(false)
  return useMemo(
    () => ({
      isEditingCellRef,
      editorSessionBaselineRef,
      pendingTypingActivationRef,
      listEditorOpeningRef,
    }),
    []
  )
}

function useGridSelectionRefs(): GridSelectionRefs {
  const lastInteractedCellRef = useRef<GridCellPosition | null>(null)
  const previousMarkedRowsRef = useRef<number[]>([])
  const previousMarkedRangesKeyRef = useRef(NO_MARKED_RANGES_KEY)
  const lastSelectedListCellRef = useRef<GridCellPosition | null>(null)
  return useMemo(
    () => ({
      lastInteractedCellRef,
      previousMarkedRowsRef,
      previousMarkedRangesKeyRef,
      lastSelectedListCellRef,
    }),
    []
  )
}

function useGridActionRefs(): GridActionRefs {
  const actionPendingRef = useRef(false)
  const actionAbortRef = useRef<AbortController | null>(null)
  const lastVisibleRegionRef = useRef<Rectangle | null>(null)
  return useMemo(() => ({ actionPendingRef, actionAbortRef, lastVisibleRegionRef }), [])
}

export function useGridSessionRefs(): GridSessionRefs {
  const scroll = useGridScrollRefs()
  const editor = useGridEditorRefs()
  const selection = useGridSelectionRefs()
  const action = useGridActionRefs()
  return useMemo(() => ({ scroll, editor, selection, action }), [scroll, editor, selection, action])
}
