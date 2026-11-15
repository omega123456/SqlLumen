import type { ReactNode } from 'react'
import { Plus, Copy, Trash, FloppyDisk, ArrowUUpLeft } from '@phosphor-icons/react'
import { Button, type ButtonVariant } from '../../../common/Button'
import { CountBadgeAnchor } from '../CountBadgeAnchor'
import type { DeleteButtonCopy, RowActionAvailability, RowActionHandlers } from './row-action-model'

interface RowActionButtonsProps {
  availability: RowActionAvailability
  deleteButton: DeleteButtonCopy
  handlers: RowActionHandlers
}

interface RowActionButtonProps {
  testId: string
  accessibleName: string
  title?: string
  disabled: boolean
  onClick: () => void
  isLabelled?: boolean
  variant?: ButtonVariant
  children: ReactNode
}

function RowActionButton({
  testId,
  accessibleName,
  title = accessibleName,
  disabled,
  onClick,
  isLabelled = false,
  variant = 'subtle',
  children,
}: RowActionButtonProps) {
  return (
    <Button
      variant={variant}
      size="toolbar"
      iconOnly={!isLabelled}
      className="shrink-0"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={accessibleName}
      data-testid={testId}
    >
      {children}
    </Button>
  )
}

function saveButtonVariant(hasPendingChanges: boolean): ButtonVariant {
  if (hasPendingChanges) return 'subtleAccent'
  return 'subtle'
}

export function RowActionButtons({ availability, deleteButton, handlers }: RowActionButtonsProps) {
  const hasPendingChanges = availability.canSaveOrDiscard
  return (
    <>
      <RowActionButton
        testId="btn-add-row"
        accessibleName="Add row"
        disabled={!availability.canAdd}
        onClick={handlers.onAdd}
      >
        <Plus size={16} weight="bold" />
      </RowActionButton>

      <RowActionButton
        testId="btn-clone-row"
        accessibleName="Clone row"
        title="Clone selected row; primary key fields are left blank."
        disabled={!availability.canClone}
        onClick={handlers.onClone}
      >
        <Copy size={16} weight="regular" />
      </RowActionButton>

      <CountBadgeAnchor badge={deleteButton.badge} badgeTestId="delete-count-badge">
        <RowActionButton
          testId="btn-delete-row"
          accessibleName={deleteButton.title}
          disabled={!availability.canDelete}
          onClick={handlers.onDelete}
        >
          <Trash size={16} weight="regular" />
        </RowActionButton>
      </CountBadgeAnchor>

      <RowActionButton
        testId="btn-save"
        accessibleName="Save changes"
        disabled={!hasPendingChanges}
        onClick={handlers.onSave}
        isLabelled={hasPendingChanges}
        variant={saveButtonVariant(hasPendingChanges)}
      >
        <FloppyDisk size={16} weight="regular" />
        {hasPendingChanges && <span className="font-semibold">Save</span>}
      </RowActionButton>

      <RowActionButton
        testId="btn-discard"
        accessibleName="Discard changes"
        disabled={!hasPendingChanges}
        onClick={handlers.onDiscard}
        isLabelled={hasPendingChanges}
      >
        <ArrowUUpLeft size={16} weight="regular" />
        {hasPendingChanges && <span>Discard</span>}
      </RowActionButton>
    </>
  )
}
