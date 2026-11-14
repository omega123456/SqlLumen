import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { RenameDialog } from '../dialogs/RenameDialog'
import {
  DropTableMessage,
  TruncateTableMessage,
  type TableTarget,
} from './ObjectBrowserActionDialogs'
import {
  dropTableSteps,
  renameTableSteps,
  truncateTableSteps,
} from '../../hooks/object-browser-actions/table-operations'
import type { TargetedOperation } from '../../hooks/object-browser-actions/use-targeted-operation'

export interface TableDialogsProps {
  connectionId: string
  dropOperation: TargetedOperation<TableTarget>
  truncateOperation: TargetedOperation<TableTarget>
  renameOperation: TargetedOperation<TableTarget>
}

export function TableDialogs({
  connectionId,
  dropOperation,
  truncateOperation,
  renameOperation,
}: TableDialogsProps) {
  return (
    <>
      <ConfirmDialog
        isOpen={dropOperation.target !== null}
        title="Drop table"
        message={<DropTableMessage target={dropOperation.target} />}
        confirmLabel="Drop table"
        isDestructive
        isLoading={dropOperation.isLoading}
        error={dropOperation.error}
        onConfirm={() => dropOperation.run(dropTableSteps(connectionId))}
        onCancel={dropOperation.close}
      />
      <ConfirmDialog
        isOpen={truncateOperation.target !== null}
        title="Truncate table"
        message={<TruncateTableMessage target={truncateOperation.target} />}
        confirmLabel="Truncate table"
        isDestructive
        isLoading={truncateOperation.isLoading}
        error={truncateOperation.error}
        onConfirm={() => truncateOperation.run(truncateTableSteps(connectionId))}
        onCancel={truncateOperation.close}
      />
      <RenameDialog
        isOpen={renameOperation.target !== null}
        title="Rename table"
        currentName={renameOperation.target?.table ?? ''}
        isLoading={renameOperation.isLoading}
        error={renameOperation.error}
        onConfirm={(newName) => renameOperation.run(renameTableSteps(connectionId, newName))}
        onCancel={renameOperation.close}
      />
    </>
  )
}
