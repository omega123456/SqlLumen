import { dropTable, renameTable, truncateTable } from '../../lib/schema-commands'
import { buildSchemaIndex, invalidateSchemaIndex } from '../../lib/schema-index-commands'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { useSchemaStore } from '../../stores/schema-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { showSuccessToast } from '../../stores/toast-store'
import type { TableTarget } from '../../components/object-browser/ObjectBrowserActionDialogs'
import type { OperationSteps } from './use-targeted-operation'

function refreshTables(connectionId: string, database: string): void {
  void useSchemaStore.getState().refreshCategory(connectionId, database, 'table')
}

export function dropTableSteps(connectionId: string): OperationSteps<TableTarget> {
  return {
    perform: async ({ db, table }) => {
      await dropTable(connectionId, db, table)
      useWorkspaceStore
        .getState()
        .closeTabsByObject(connectionId, { databaseName: db, objectName: table })
    },
    afterSuccess: ({ db, table }) => {
      refreshTables(connectionId, db)
      showSuccessToast('Table dropped', `${db}.${table}`)
      invalidateSchemaIndex(connectionId, [`${db}.${table}`]).catch((error: unknown) => {
        logFrontend(
          'warn',
          `[object-browser-actions] Schema index invalidation after drop failed: ${String(error)}`
        )
      })
    },
    failureTitle: () => 'Failed to drop table',
  }
}

export function truncateTableSteps(connectionId: string): OperationSteps<TableTarget> {
  return {
    perform: async ({ db, table }) => {
      await truncateTable(connectionId, db, table)
    },
    afterSuccess: ({ db, table }) => {
      refreshTables(connectionId, db)
      showSuccessToast('Table truncated', `${db}.${table}`)
    },
    failureTitle: () => 'Failed to truncate table',
  }
}

function rebuildIndexAfterRename(connectionId: string, previousQualifiedName: string): void {
  invalidateSchemaIndex(connectionId, [previousQualifiedName])
    .then(() => buildSchemaIndex(connectionId))
    .catch((error) => {
      const message = toErrorMessage(error)
      logFrontend(
        'warn',
        `[useObjectBrowserActions] schema index rebuild after rename failed: ${message}`
      )
    })
}

export function renameTableSteps(
  connectionId: string,
  newName: string
): OperationSteps<TableTarget> {
  return {
    perform: async ({ db, table }) => {
      await renameTable({
        connectionId: connectionId,
        database: db,
        oldName: table,
        newName: newName,
      })
      useWorkspaceStore.getState().updateTabObject(connectionId, {
        databaseName: db,
        oldObjectName: table,
        newObjectName: newName,
      })
    },
    afterSuccess: ({ db, table }) => {
      refreshTables(connectionId, db)
      showSuccessToast('Table renamed', `${table} → ${newName}`)
      rebuildIndexAfterRename(connectionId, `${db}.${table}`)
    },
    failureTitle: () => 'Failed to rename table',
  }
}
