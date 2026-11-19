import { formatCount } from '../../../../lib/format-row-count'
import { BULK_DELETE_WARNING_ROWS, MAX_BULK_DELETE_ROWS } from '../../../../lib/data-view-limits'

export interface RowActionAvailability {
  canAdd: boolean
  canClone: boolean
  canDelete: boolean
  canSaveOrDiscard: boolean
}

export interface RowActionHandlers {
  onAdd: () => void
  onClone: () => void
  onDelete: () => void
  onSave: () => void
  onDiscard: () => void
}

export interface RowActionFacts {
  canMutate: boolean
  canAddRow: boolean
  canCloneSelection: boolean
  deleteTargetCount: number
  hasPendingChanges: boolean
  isBusy: boolean
}

export function rowActionAvailability(facts: RowActionFacts): RowActionAvailability {
  const canMutateNow = facts.canMutate && !facts.isBusy
  return {
    canAdd: canMutateNow && facts.canAddRow,
    canClone: canMutateNow && facts.canCloneSelection,
    canDelete: canMutateNow && facts.deleteTargetCount > 0,
    canSaveOrDiscard: facts.hasPendingChanges && !facts.isBusy,
  }
}

export function deleteTargetCountFor(checkedCount: number, hasDeletableSelection: boolean): number {
  if (checkedCount > 0) return checkedCount
  if (hasDeletableSelection) return 1
  return 0
}

const MAX_DELETE_BADGE_COUNT = 99
const DELETE_BADGE_OVERFLOW = `${MAX_DELETE_BADGE_COUNT}+`

export interface DeleteButtonCopy {
  title: string
  badge: string | null
}

function deleteBadgeFor(deleteTargetCount: number): string {
  if (deleteTargetCount > MAX_DELETE_BADGE_COUNT) return DELETE_BADGE_OVERFLOW
  return String(deleteTargetCount)
}

export function deleteButtonCopyFor(deleteTargetCount: number): DeleteButtonCopy {
  if (deleteTargetCount > 1) {
    return {
      title: `Delete ${formatCount(deleteTargetCount)} rows`,
      badge: deleteBadgeFor(deleteTargetCount),
    }
  }
  return { title: 'Delete row', badge: null }
}

export interface DeleteDialogCopy {
  title: string
  message: string
  confirmLabel: string
  warningText: string | null | undefined
  isDestructive: boolean
  blocked: boolean
}

export function getDeleteDialogCopy(count: number, tableName: string): DeleteDialogCopy {
  const formattedCount = formatCount(count)
  if (count > MAX_BULK_DELETE_ROWS) {
    return {
      title: 'Too many rows to delete at once',
      message: `You have ${formattedCount} rows checked. You can delete up to ${formatCount(
        MAX_BULK_DELETE_ROWS
      )} rows at a time. Uncheck some rows, then try again.`,
      confirmLabel: 'OK',
      warningText: null,
      isDestructive: false,
      blocked: true,
    }
  }
  if (count === 1) {
    return {
      title: 'Delete row',
      message: `Delete this row from ${tableName}?`,
      confirmLabel: 'Delete row',
      warningText: undefined,
      isDestructive: true,
      blocked: false,
    }
  }
  return {
    title: 'Delete rows',
    message: `Delete ${formattedCount} rows from ${tableName}?`,
    confirmLabel: `Delete ${formattedCount} rows`,
    warningText:
      count > BULK_DELETE_WARNING_ROWS
        ? "This can't be undone. Deleting more than 1,000 rows can take a while. If a row fails, rows already deleted stay deleted."
        : undefined,
    isDestructive: true,
    blocked: false,
  }
}
