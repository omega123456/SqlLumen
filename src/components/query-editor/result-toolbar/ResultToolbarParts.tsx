import { Copy, FloppyDisk, Trash } from '@phosphor-icons/react'
import { formatCount } from '../../../lib/format-row-count'
import { Button } from '../../common/Button'
import { ConfirmDialog } from '../../dialogs/ConfirmDialog'
import type { useDeleteCheckedRows } from './use-delete-checked-rows'
import { pluralSuffix, type ActiveResult } from './result-toolbar-model'
import styles from '../ResultToolbar.module.css'

function CloneActionGroup({ isDisabled, onClone }: { isDisabled: boolean; onClone: () => void }) {
  return (
    <div className={styles.editActionsGroup} data-testid="clone-actions-group">
      <Button
        variant="bare"
        className={styles.cloneButton}
        onClick={onClone}
        title="Clone selected row; primary key fields are left blank."
        data-testid="query-clone-button"
        disabled={isDisabled}
      >
        <Copy size={16} weight="regular" />
        <span>Clone</span>
      </Button>
    </div>
  )
}

interface DeleteRowsActionGroupProps {
  editMode: string | null
  checkedCount: number
  onDelete: () => void
}

function DeleteRowsActionGroup({ editMode, checkedCount, onDelete }: DeleteRowsActionGroupProps) {
  if (editMode === null) return null
  if (checkedCount === 0) return null
  const formattedCount = formatCount(checkedCount)
  return (
    <div className={styles.editActionsGroup} data-testid="result-delete-actions-group">
      <Button
        variant="bare"
        className={styles.discardButton}
        onClick={onDelete}
        title={`Delete ${formattedCount} selected row${pluralSuffix(checkedCount)} from the database`}
        data-testid="query-delete-rows-button"
      >
        <Trash size={16} weight="regular" />
        <span>Delete ({formattedCount})</span>
      </Button>
    </div>
  )
}

interface SaveDiscardActionGroupProps {
  editState: ActiveResult['editState']
  onSave: () => void
  onDiscard: () => void
}

function SaveDiscardActionGroup({ editState, onSave, onDiscard }: SaveDiscardActionGroupProps) {
  if (editState === null) return null
  const hasModifications = editState.modifiedColumns.size > 0
  return (
    <div className={styles.editActionsGroup} data-testid="edit-actions-group">
      {hasModifications && (
        <Button
          variant="bare"
          className={styles.saveButton}
          onClick={onSave}
          title="Save changes"
          data-testid="query-save-button"
        >
          <FloppyDisk size={16} weight="regular" />
          <span>Save</span>
        </Button>
      )}
      <Button
        variant="bare"
        className={styles.discardButton}
        onClick={onDiscard}
        title="Discard changes"
        data-testid="query-discard-button"
      >
        <span>Discard</span>
      </Button>
    </div>
  )
}

interface ResultEditActionGroupsProps {
  result: ActiveResult
  checkedCount: number
  clone: { isVisible: boolean; isDisabled: boolean; onClone: () => void }
  onDelete: () => void
  onSave: () => void
  onDiscard: () => void
}

export function ResultEditActionGroups({
  result,
  checkedCount,
  clone,
  onDelete,
  onSave,
  onDiscard,
}: ResultEditActionGroupsProps) {
  return (
    <>
      {clone.isVisible && (
        <CloneActionGroup isDisabled={clone.isDisabled} onClone={clone.onClone} />
      )}
      <DeleteRowsActionGroup
        editMode={result.editMode}
        checkedCount={checkedCount}
        onDelete={onDelete}
      />
      <SaveDiscardActionGroup editState={result.editState} onSave={onSave} onDiscard={onDiscard} />
    </>
  )
}

export function DeleteRowsConfirmDialog({
  deletion,
}: {
  deletion: ReturnType<typeof useDeleteCheckedRows>
}) {
  const { deleteCopy } = deletion
  return (
    <ConfirmDialog
      isOpen={deletion.showDeleteConfirm}
      title={deleteCopy.title}
      message={deleteCopy.message}
      confirmLabel={deleteCopy.confirmLabel}
      isDestructive={deleteCopy.isDestructive}
      warningText={deleteCopy.warningText}
      hideCancel={deleteCopy.blocked}
      onConfirm={deletion.handleConfirmDelete}
      onCancel={deletion.handleCancelDelete}
    />
  )
}
