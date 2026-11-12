import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import type { EditableObjectType } from '../../types/schema'
import { EDITABLE_OBJECT_TYPE_LABELS } from '../../lib/editable-object-type-labels'

export interface DatabaseTarget {
  name: string
}

export interface TableTarget {
  db: string
  table: string
}

export interface DropObjectTarget {
  databaseName: string
  objectName: string
  objectType: EditableObjectType
}

export function DropDatabaseMessage({ target }: { target: DatabaseTarget | null }) {
  return (
    <>
      Are you sure you want to drop database <strong>{target?.name ?? ''}</strong>?
    </>
  )
}

function QualifiedTableName({ target }: { target: TableTarget | null }) {
  return (
    <strong>
      {target?.db ?? ''}.{target?.table ?? ''}
    </strong>
  )
}

export function DropTableMessage({ target }: { target: TableTarget | null }) {
  return (
    <>
      Are you sure you want to drop table <QualifiedTableName target={target} />?
    </>
  )
}

export function TruncateTableMessage({ target }: { target: TableTarget | null }) {
  return (
    <>
      Are you sure you want to truncate table <QualifiedTableName target={target} />? All data will
      be deleted.
    </>
  )
}

interface DropObjectConfirmDialogProps {
  target: DropObjectTarget | null
  isLoading: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function DropObjectConfirmDialog({
  target,
  isLoading,
  error,
  onConfirm,
  onCancel,
}: DropObjectConfirmDialogProps) {
  if (!target) return null
  const typeLabel = EDITABLE_OBJECT_TYPE_LABELS[target.objectType]
  return (
    <ConfirmDialog
      isOpen
      title={`Drop ${typeLabel}`}
      message={
        <>
          Are you sure you want to drop {typeLabel.toLowerCase()}{' '}
          <strong>&apos;{target.objectName}&apos;</strong> from database{' '}
          <strong>&apos;{target.databaseName}&apos;</strong>? This action cannot be undone.
        </>
      }
      confirmLabel={`Drop ${typeLabel}`}
      isDestructive
      isLoading={isLoading}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
