interface ModifiedColumnTracking {
  modifiedColumns: ReadonlySet<string>
}

interface PendingRowEdit extends ModifiedColumnTracking {
  isNewRow?: boolean
}

export function hasModifiedColumns(editState: ModifiedColumnTracking | null | undefined): boolean {
  if (!editState) return false
  return editState.modifiedColumns.size > 0
}

export function hasPendingRowChanges(editState: PendingRowEdit | null | undefined): boolean {
  if (!editState) return false
  return editState.isNewRow === true || hasModifiedColumns(editState)
}
