import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { isUnchangedForeignKeySelection } from '../../../lib/foreign-key-utils'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { ForeignKeyColumnInfo } from '../../../types/schema'
import type { CellClickGuardArgs, GridColumnDescriptor } from '../../../types/shared-data-view'
import type { FkLookupArgs } from '../fk-lookup-context'
import type { GridCellPosition, GridHandle } from '../glide/glide-grid-types'
import {
  isEditingRow,
  leaveEditingRowFor,
  startEditingIfNeeded,
  type CellTarget,
  type RowEditSession,
} from './row-edit-session'

const REPEAT_POINTER_LOOKUP_COOLDOWN_MS = 250

export interface ForeignKeyLookupTarget<RowIdentity> extends CellTarget<RowIdentity> {
  sourceColumn: string
  currentValue: unknown
  foreignKey: ForeignKeyColumnInfo
}

export interface GridFocusTarget {
  gridRef: RefObject<GridHandle | null>
  selectedCellPosition: GridCellPosition | null
}

export interface ForeignKeyLookupInputs<RowIdentity> {
  session: RowEditSession<RowIdentity>
  columns: GridColumnDescriptor[]
  isActive: boolean
  gridFocus: GridFocusTarget | null
}

export interface ForeignKeyLookup<RowIdentity> {
  target: ForeignKeyLookupTarget<RowIdentity> | null
  isReadOnly: boolean
  openLookup: (args: FkLookupArgs) => Promise<void>
  onFkCellAction: (args: CellClickGuardArgs) => Promise<void>
  applyLookup: (selectedValue: unknown) => void
  closeLookup: () => void
}

function sourceColumnOf(columns: GridColumnDescriptor[], columnKey: string): string {
  const column = columns.find((candidate) => candidate.key === columnKey)
  return column?.tableColumnMeta?.name ?? columnKey
}

function lookupTargetOf<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  columns: GridColumnDescriptor[],
  args: FkLookupArgs
): ForeignKeyLookupTarget<RowIdentity> {
  const identity = session.identityOf(args.rowData)
  return {
    identity: identity,
    rowIndex: session.rowIndexOf(identity),
    rowData: args.rowData,
    columnKey: args.columnKey,
    sourceColumn: sourceColumnOf(columns, args.columnKey),
    currentValue: args.currentValue,
    foreignKey: args.foreignKey,
  }
}

function isUnchangedSelection<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  target: ForeignKeyLookupTarget<RowIdentity>,
  selectedValue: unknown
): boolean {
  const isEditingTargetRow = isEditingRow(session, target.identity)
  return isUnchangedForeignKeySelection({
    selectedValue: selectedValue,
    currentValue: target.currentValue,
    rowEditState: isEditingTargetRow ? { modifiedColumns: session.modifiedColumnKeys() } : null,
  })
}

function writeSelectedValue<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  target: ForeignKeyLookupTarget<RowIdentity>,
  selectedValue: unknown
): void {
  if (!isUnchangedSelection(session, target, selectedValue)) {
    startEditingIfNeeded(session, target.identity, target.rowData)
    session.commitCellValue(target, selectedValue)
  }
  session.selectCell(target)
}

function isRepeatPointerLookup(args: FkLookupArgs, ignorePointerUntilMs: number): boolean {
  return args.source === 'grid-pointer' && Date.now() < ignorePointerUntilMs
}

function useOpenLookup<RowIdentity>(
  inputs: ForeignKeyLookupInputs<RowIdentity>,
  setTarget: (target: ForeignKeyLookupTarget<RowIdentity>) => void,
  ignorePointerUntilRef: RefObject<number>
) {
  const { session, columns, isActive } = inputs
  return useCallback(
    async (args: FkLookupArgs) => {
      if (!isActive) return
      if (isRepeatPointerLookup(args, ignorePointerUntilRef.current)) return
      const target = lookupTargetOf(session, columns, args)
      const canLeaveEditingRow = await leaveEditingRowFor(session, target.identity)
      if (!canLeaveEditingRow) return
      session.selectCell(target)
      setTarget(target)
    },
    [session, columns, isActive, ignorePointerUntilRef, setTarget]
  )
}

function useForeignKeyCellAction(
  columns: GridColumnDescriptor[],
  openLookup: (args: FkLookupArgs) => Promise<void>
) {
  return useCallback(
    async (args: CellClickGuardArgs) => {
      const foreignKey = columns.find((column) => column.key === args.columnKey)?.foreignKey
      if (!foreignKey) return
      await openLookup({
        columnKey: args.columnKey,
        currentValue: args.rowData[args.columnKey],
        foreignKey: foreignKey,
        rowData: args.rowData,
        source: args.source === 'keyboard' ? 'keyboard' : 'grid-pointer',
      })
    },
    [columns, openLookup]
  )
}

interface FocusRestore {
  gridFocus: GridFocusTarget | null
  isLookupOpen: boolean
  restoreFocusRef: RefObject<boolean>
}

function useRestoreGridFocusAfterLookup({
  gridFocus,
  isLookupOpen,
  restoreFocusRef,
}: FocusRestore) {
  const gridRef = gridFocus?.gridRef
  const selectedCellPosition = gridFocus?.selectedCellPosition ?? null
  useLayoutEffect(() => {
    if (isLookupOpen) return
    if (!restoreFocusRef.current) return
    if (!selectedCellPosition) return
    restoreFocusRef.current = false
    gridRef?.current?.selectCell(selectedCellPosition, {
      shouldFocusCell: true,
      enableEditor: false,
    })
  }, [isLookupOpen, selectedCellPosition, gridRef, restoreFocusRef])
}

interface LookupLifecycle {
  tabId: string
  isActive: boolean
  isLookupOpen: boolean
  closeLookup: () => void
}

function useLookupLifecycle({ tabId, isActive, isLookupOpen, closeLookup }: LookupLifecycle) {
  const setBlockingNavigation = useWorkspaceStore((state) => state.setBlockingNavigation)
  useEffect(() => {
    setBlockingNavigation(tabId, isLookupOpen)
    return () => setBlockingNavigation(tabId, false)
  }, [isLookupOpen, setBlockingNavigation, tabId])
  useEffect(() => {
    if (isActive) return
    if (!isLookupOpen) return
    queueMicrotask(closeLookup)
  }, [closeLookup, isActive, isLookupOpen])
}

export function useForeignKeyLookup<RowIdentity>(
  inputs: ForeignKeyLookupInputs<RowIdentity>
): ForeignKeyLookup<RowIdentity> {
  const { session } = inputs
  const [target, setTarget] = useState<ForeignKeyLookupTarget<RowIdentity> | null>(null)
  const ignorePointerUntilRef = useRef(0)
  const restoreFocusRef = useRef(false)
  const isLookupOpen = target !== null

  const closeLookup = useCallback(() => {
    ignorePointerUntilRef.current = Date.now() + REPEAT_POINTER_LOOKUP_COOLDOWN_MS
    restoreFocusRef.current = true
    setTarget(null)
  }, [])
  const applyLookup = useCallback(
    (selectedValue: unknown) => {
      if (!target) return
      writeSelectedValue(session, target, selectedValue)
      closeLookup()
    },
    [closeLookup, session, target]
  )
  const openLookup = useOpenLookup(inputs, setTarget, ignorePointerUntilRef)

  useRestoreGridFocusAfterLookup({
    gridFocus: inputs.gridFocus,
    isLookupOpen: isLookupOpen,
    restoreFocusRef: restoreFocusRef,
  })
  useLookupLifecycle({
    tabId: session.tabId,
    isActive: inputs.isActive,
    isLookupOpen: isLookupOpen,
    closeLookup: closeLookup,
  })

  return {
    target: target,
    isReadOnly: !session.canEditRows,
    openLookup: openLookup,
    onFkCellAction: useForeignKeyCellAction(inputs.columns, openLookup),
    applyLookup: applyLookup,
    closeLookup: closeLookup,
  }
}
