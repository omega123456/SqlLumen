import { useCallback } from 'react'
import type { ReactNode } from 'react'
import {
  DropObjectConfirmDialog,
  type DropObjectTarget,
} from '../../components/object-browser/ObjectBrowserActionDialogs'
import type { EditableObjectType } from '../../types/schema'
import {
  dropObjectSteps,
  openAlterObjectTab,
  openCreateObjectTab,
  openExecuteRoutineTab,
  type RoutineType,
} from './object-operations'
import { useTargetedOperation } from './use-targeted-operation'

export interface ObjectActions {
  onAlterObject: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onCreateObject: (databaseName: string, objectType: EditableObjectType) => void
  onDropObject: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onExecuteRoutine: (databaseName: string, routineName: string, routineType: RoutineType) => void
  dialogs: ReactNode
}

export function useObjectActions(connectionId: string): ObjectActions {
  const dropOperation = useTargetedOperation<DropObjectTarget>()
  const { open: openDrop } = dropOperation

  const onAlterObject = useCallback(
    (databaseName: string, objectName: string, objectType: EditableObjectType) =>
      openAlterObjectTab({ connectionId, databaseName, objectType }, objectName),
    [connectionId]
  )
  const onCreateObject = useCallback(
    (databaseName: string, objectType: EditableObjectType) =>
      openCreateObjectTab({ connectionId, databaseName, objectType }),
    [connectionId]
  )
  const onDropObject = useCallback(
    (databaseName: string, objectName: string, objectType: EditableObjectType) =>
      openDrop({ databaseName, objectName, objectType }),
    [openDrop]
  )
  const onExecuteRoutine = useCallback(
    (databaseName: string, routineName: string, routineType: RoutineType) =>
      openExecuteRoutineTab({ connectionId, databaseName, routineName, routineType }),
    [connectionId]
  )

  return {
    onAlterObject: onAlterObject,
    onCreateObject: onCreateObject,
    onDropObject: onDropObject,
    onExecuteRoutine: onExecuteRoutine,
    dialogs: (
      <DropObjectConfirmDialog
        target={dropOperation.target}
        isLoading={dropOperation.isLoading}
        error={dropOperation.error}
        onConfirm={() => dropOperation.run(dropObjectSteps(connectionId))}
        onCancel={dropOperation.close}
      />
    ),
  }
}
