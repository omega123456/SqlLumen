import { dropDatabase, renameDatabase } from '../../lib/schema-commands'
import { buildSchemaIndex } from '../../lib/schema-index-commands'
import { logFrontend } from '../../lib/app-log-commands'
import { useConnectionStore } from '../../stores/connection-store'
import { useSchemaStore } from '../../stores/schema-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { showSuccessToast } from '../../stores/toast-store'
import { invalidateRoutineCache } from '../../components/query-editor/routine-parameter-cache'
import { invalidateCache as invalidateSchemaMetadataCache } from '../../components/query-editor/schema-metadata-cache'
import type { DatabaseTarget } from '../../components/object-browser/ObjectBrowserActionDialogs'
import type { OperationSteps } from './use-targeted-operation'

function isDefaultDatabase(connectionId: string, databaseName: string): boolean {
  const profile = useConnectionStore.getState().activeConnections[connectionId]?.profile
  return profile?.defaultDatabase === databaseName
}

function refreshAfterDatabaseChange(connectionId: string): void {
  invalidateRoutineCache(connectionId)
  invalidateSchemaMetadataCache(connectionId)
  void useSchemaStore.getState().refreshAll(connectionId)
}

export function renameDatabaseSteps(connectionId: string, newName: string): OperationSteps<string> {
  return {
    perform: async (databaseName) => {
      await renameDatabase(connectionId, databaseName, newName)
      useWorkspaceStore.getState().updateTabDatabase(connectionId, databaseName, newName)
      if (isDefaultDatabase(connectionId, databaseName)) {
        void useConnectionStore.getState().updateDefaultDatabase(connectionId, newName)
      }
    },
    afterSuccess: (databaseName) => {
      refreshAfterDatabaseChange(connectionId)
      showSuccessToast('Database renamed', `${databaseName} → ${newName}`)
    },
    failureTitle: () => 'Failed to rename database',
  }
}

export function dropDatabaseSteps(connectionId: string): OperationSteps<DatabaseTarget> {
  return {
    perform: async ({ name }) => {
      await dropDatabase(connectionId, name)
      useWorkspaceStore.getState().closeTabsByDatabase(connectionId, name)
      if (isDefaultDatabase(connectionId, name)) {
        void useConnectionStore.getState().updateDefaultDatabase(connectionId, null)
      }
    },
    afterSuccess: ({ name }) => {
      refreshAfterDatabaseChange(connectionId)
      showSuccessToast('Database dropped', name)
      buildSchemaIndex(connectionId).catch((error: unknown) => {
        logFrontend(
          'warn',
          `[object-browser-actions] Schema index rebuild after drop failed: ${String(error)}`
        )
      })
    },
    failureTitle: () => 'Failed to drop database',
  }
}
