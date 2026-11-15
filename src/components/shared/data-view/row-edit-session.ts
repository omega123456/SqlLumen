import type { BlobValueResponse } from '../../../types/schema'

export type GridRowData = Record<string, unknown>

export interface CellTarget<RowIdentity> {
  identity: RowIdentity
  rowIndex: number
  rowData: GridRowData
  columnKey: string
}

export interface RowSaveOutcome {
  saved: boolean
  invalidColumnKey: string | null
}

export interface BlobContent {
  loader?: () => Promise<BlobValueResponse>
  initialBase64?: string | null
}

export interface RowEditSession<RowIdentity> {
  tabId: string
  canEditRows: boolean
  identityOf: (rowData: GridRowData) => RowIdentity
  isSameRow: (left: RowIdentity, right: RowIdentity) => boolean
  editingRow: () => RowIdentity | null
  editingRowIndex: (fallbackRowIndex: number) => number
  rowIndexOf: (identity: RowIdentity) => number
  columnIndexOf: (columnKey: string) => number
  isColumnEditable: (columnKey: string) => boolean
  modifiedColumnKeys: () => ReadonlySet<string>
  isEditingNewRow: () => boolean
  startEditing: (identity: RowIdentity, rowData: GridRowData) => void
  updateCell: (columnKey: string, value: unknown) => void
  commitCellValue: (target: CellTarget<RowIdentity>, value: unknown) => void
  selectCell: (target: CellTarget<RowIdentity>) => void
  saveEditingRow: () => Promise<RowSaveOutcome>
  discardEditingRow: () => void
  blobContentFor: (target: CellTarget<RowIdentity>) => BlobContent | null
}

export interface CellLocation {
  rowIdx: number
  columnKey: string
  rowData: GridRowData
}

export function cellTargetOf<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  location: CellLocation
): CellTarget<RowIdentity> {
  return {
    identity: session.identityOf(location.rowData),
    rowIndex: location.rowIdx,
    rowData: location.rowData,
    columnKey: location.columnKey,
  }
}

export function isEditingRow<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  identity: RowIdentity
): boolean {
  const editing = session.editingRow()
  if (editing === null) return false
  return session.isSameRow(editing, identity)
}

export function hasPendingChanges<RowIdentity>(session: RowEditSession<RowIdentity>): boolean {
  return session.modifiedColumnKeys().size > 0
}

export function startEditingIfNeeded<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  identity: RowIdentity,
  rowData: GridRowData
): void {
  if (!session.canEditRows) return
  if (isEditingRow(session, identity)) return
  session.startEditing(identity, rowData)
}

export function releaseRowIfUnmodified<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  identity: RowIdentity
): void {
  if (!isEditingRow(session, identity)) return
  if (session.isEditingNewRow()) return
  if (hasPendingChanges(session)) return
  session.discardEditingRow()
}

export function releaseEditingRowIfClean<RowIdentity>(
  session: RowEditSession<RowIdentity>
): boolean {
  const editing = session.editingRow()
  if (editing === null) return true
  if (hasPendingChanges(session)) return false
  releaseRowIfUnmodified(session, editing)
  return true
}

export async function leaveCurrentEditingRow<RowIdentity>(
  session: RowEditSession<RowIdentity>
): Promise<boolean> {
  if (releaseEditingRowIfClean(session)) return true
  const outcome = await session.saveEditingRow()
  return outcome.saved
}

export async function leaveEditingRowFor<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  target: RowIdentity
): Promise<boolean> {
  if (isEditingRow(session, target)) return true
  return leaveCurrentEditingRow(session)
}

export function isModifiedCellOf<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  rowData: GridRowData,
  columnKey: string
): boolean {
  if (!isEditingRow(session, session.identityOf(rowData))) return false
  return session.modifiedColumnKeys().has(columnKey)
}
