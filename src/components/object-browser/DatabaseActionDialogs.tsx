import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { CreateDatabaseDialog } from '../dialogs/CreateDatabaseDialog'
import { AlterDatabaseDialog } from '../dialogs/AlterDatabaseDialog'
import { RenameDialog } from '../dialogs/RenameDialog'
import { DropDatabaseMessage, type DatabaseTarget } from './ObjectBrowserActionDialogs'
import {
  dropDatabaseSteps,
  renameDatabaseSteps,
} from '../../hooks/object-browser-actions/database-operations'
import type { TargetedOperation } from '../../hooks/object-browser-actions/use-targeted-operation'

const RENAME_DB_WARNING =
  'This operation will create a new database, move all tables, and drop the original. Only works for databases containing tables only (no views, procedures, functions, triggers, or events).'

export interface DatabaseDialogsProps {
  connectionId: string
  isCreateOpen: boolean
  alterTarget: string | null
  renameOperation: TargetedOperation<string>
  dropOperation: TargetedOperation<DatabaseTarget>
  onCreateClose: () => void
  onCreateSuccess: (name: string) => void
  onAlterClose: () => void
  onAlterSuccess: () => void
}

export function DatabaseDialogs(props: DatabaseDialogsProps) {
  const { connectionId, renameOperation, dropOperation } = props
  return (
    <>
      <CreateDatabaseDialog
        isOpen={props.isCreateOpen}
        connectionId={connectionId}
        onSuccess={props.onCreateSuccess}
        onCancel={props.onCreateClose}
      />
      <AlterDatabaseDialog
        isOpen={props.alterTarget !== null}
        connectionId={connectionId}
        databaseName={props.alterTarget ?? ''}
        onSuccess={props.onAlterSuccess}
        onCancel={props.onAlterClose}
      />
      <RenameDialog
        isOpen={renameOperation.target !== null}
        title="Rename database"
        currentName={renameOperation.target ?? ''}
        warning={RENAME_DB_WARNING}
        isLoading={renameOperation.isLoading}
        error={renameOperation.error}
        onConfirm={(newName) => renameOperation.run(renameDatabaseSteps(connectionId, newName))}
        onCancel={renameOperation.close}
      />
      <ConfirmDialog
        isOpen={dropOperation.target !== null}
        title="Drop database"
        message={<DropDatabaseMessage target={dropOperation.target} />}
        confirmLabel="Drop database"
        isDestructive
        isLoading={dropOperation.isLoading}
        error={dropOperation.error}
        onConfirm={() => dropOperation.run(dropDatabaseSteps(connectionId))}
        onCancel={dropOperation.close}
      />
    </>
  )
}
