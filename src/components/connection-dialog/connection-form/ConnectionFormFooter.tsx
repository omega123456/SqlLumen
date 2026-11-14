import { Plug } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { PendingAction } from '../connection-editor-state'
import styles from '../ConnectionForm.module.css'

const FOOTER_ICON_SIZE = 16

const PENDING_ACTION_LABELS: Record<Exclude<PendingAction, 'delete'>, string> = {
  test: 'Testing…',
  connect: 'Connecting…',
  save: 'Saving…',
}

interface ActionLabelInputs {
  pendingAction: PendingAction | null
  action: Exclude<PendingAction, 'delete'>
  idleLabel: string
}

function actionLabel(inputs: ActionLabelInputs): string {
  if (inputs.pendingAction === inputs.action) return PENDING_ACTION_LABELS[inputs.action]
  return inputs.idleLabel
}

interface ConnectionFormFooterProps {
  pendingAction: PendingAction | null
  canDelete: boolean
  onTest: () => void
  onDeleteRequest: () => void
  onConnect: () => void
  onSave: () => void
}

export function ConnectionFormFooter({
  pendingAction,
  canDelete,
  onTest,
  onDeleteRequest,
  onConnect,
  onSave,
}: ConnectionFormFooterProps) {
  const isAnyPending = pendingAction !== null
  return (
    <footer className={styles.formFooter}>
      <div className={styles.footerActionsLeft}>
        <Button onClick={onTest} disabled={isAnyPending}>
          <Plug size={FOOTER_ICON_SIZE} weight="regular" aria-hidden />
          {actionLabel({
            pendingAction: pendingAction,
            action: 'test',
            idleLabel: 'Test connection',
          })}
        </Button>
        {canDelete ? (
          <Button variant="danger" onClick={onDeleteRequest} disabled={isAnyPending}>
            Delete
          </Button>
        ) : null}
      </div>
      <div className={styles.footerActionsRight}>
        <Button variant="accent" onClick={onConnect} disabled={isAnyPending}>
          {actionLabel({
            pendingAction: pendingAction,
            action: 'connect',
            idleLabel: 'Save and connect',
          })}
        </Button>
        <Button onClick={onSave} disabled={isAnyPending}>
          {actionLabel({ pendingAction: pendingAction, action: 'save', idleLabel: 'Save' })}
        </Button>
      </div>
    </footer>
  )
}
