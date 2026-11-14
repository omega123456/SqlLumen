import { dropObject, getRoutineParameters } from '../../lib/object-editor-commands'
import { buildExecuteTemplate } from '../../lib/execute-template-builder'
import { EDITABLE_OBJECT_TYPE_LABELS } from '../../lib/editable-object-type-labels'
import { logFrontend } from '../../lib/app-log-commands'
import { useSchemaStore } from '../../stores/schema-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { isRoutineObject } from '../../stores/object-editor-store'
import { showSuccessToast, showWarningToast } from '../../stores/toast-store'
import { invalidateRoutineCache } from '../../components/query-editor/routine-parameter-cache'
import { invalidateCache as invalidateSchemaMetadataCache } from '../../components/query-editor/schema-metadata-cache'
import type { DropObjectTarget } from '../../components/object-browser/ObjectBrowserActionDialogs'
import type { EditableObjectType } from '../../types/schema'
import type { OperationSteps } from './use-targeted-operation'

const PLACEHOLDER_NAMES: Record<EditableObjectType, string> = {
  procedure: 'new_procedure',
  function: 'new_function',
  trigger: 'new_trigger',
  event: 'new_event',
  view: 'new_view',
}

const CREATE_LABELS: Record<EditableObjectType, string> = {
  procedure: 'New procedure',
  function: 'New function',
  trigger: 'New trigger',
  event: 'New event',
  view: 'New view',
}

export type RoutineType = 'procedure' | 'function'

export interface ObjectLocation {
  connectionId: string
  databaseName: string
  objectType: EditableObjectType
}

export function openAlterObjectTab(location: ObjectLocation, objectName: string): void {
  useWorkspaceStore.getState().openTab({
    type: 'object-editor',
    label: `${EDITABLE_OBJECT_TYPE_LABELS[location.objectType]}: ${objectName}`,
    connectionId: location.connectionId,
    databaseName: location.databaseName,
    objectName: objectName,
    objectType: location.objectType,
    mode: 'alter',
  })
}

export function openCreateObjectTab(location: ObjectLocation): void {
  useWorkspaceStore.getState().openTab({
    type: 'object-editor',
    label: CREATE_LABELS[location.objectType],
    connectionId: location.connectionId,
    databaseName: location.databaseName,
    objectName: PLACEHOLDER_NAMES[location.objectType],
    objectType: location.objectType,
    mode: 'create',
  })
}

export interface RoutineToExecute {
  connectionId: string
  databaseName: string
  routineName: string
  routineType: RoutineType
}

function fallbackExecuteTemplate({ databaseName, routineName, routineType }: RoutineToExecute) {
  const keyword = routineType === 'procedure' ? 'CALL' : 'SELECT'
  return `${keyword} \`${databaseName}\`.\`${routineName}\`( /* Add parameters here */ );`
}

async function executeTemplateFor(routine: RoutineToExecute): Promise<string> {
  const parameters = await getRoutineParameters({
    connectionId: routine.connectionId,
    database: routine.databaseName,
    routineName: routine.routineName,
    routineType: routine.routineType,
  })
  return buildExecuteTemplate({
    databaseName: routine.databaseName,
    routineName: routine.routineName,
    routineType: routine.routineType,
    parameters: parameters,
  })
}

function openExecuteTab(routine: RoutineToExecute, template: string): void {
  const tabId = useWorkspaceStore
    .getState()
    .openQueryTab(routine.connectionId, `Execute: ${routine.routineName}`)
  useQueryStore.getState().setContent(tabId, template)
}

export async function openExecuteRoutineTab(routine: RoutineToExecute): Promise<void> {
  try {
    openExecuteTab(routine, await executeTemplateFor(routine))
  } catch {
    openExecuteTab(routine, fallbackExecuteTemplate(routine))
    showWarningToast('Could not load parameters', 'Showing basic template')
  }
}

async function refreshAfterObjectDrop(connectionId: string, target: DropObjectTarget) {
  try {
    await useSchemaStore
      .getState()
      .refreshCategory(connectionId, target.databaseName, target.objectType)
  } catch (error) {
    logFrontend(
      'warn',
      `[object-browser-actions] Refreshing the object category after drop failed: ${String(error)}`
    )
  }
  try {
    await useSchemaStore.getState().refreshDatabase(connectionId, target.databaseName)
  } catch (error) {
    logFrontend(
      'warn',
      `[object-browser-actions] Refreshing the database after drop failed: ${String(error)}`
    )
  }
}

export function dropObjectSteps(connectionId: string): OperationSteps<DropObjectTarget> {
  return {
    perform: async ({ databaseName, objectName, objectType }) => {
      await dropObject({
        connectionId: connectionId,
        database: databaseName,
        objectName: objectName,
        objectType: objectType,
      })
      useWorkspaceStore.getState().closeTabsByObject(connectionId, {
        databaseName: databaseName,
        objectName: objectName,
        objectType: objectType,
      })
    },
    afterSuccess: async (target) => {
      if (isRoutineObject(target.objectType)) {
        invalidateRoutineCache(connectionId)
        invalidateSchemaMetadataCache(connectionId)
      }
      await refreshAfterObjectDrop(connectionId, target)
      const typeLabel = EDITABLE_OBJECT_TYPE_LABELS[target.objectType]
      showSuccessToast(`${typeLabel} dropped`, `${target.databaseName}.${target.objectName}`)
    },
    failureTitle: (target) => `Failed to drop ${target.objectType}`,
  }
}
