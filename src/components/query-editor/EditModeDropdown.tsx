import { useCallback, useMemo } from 'react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { useQueryStore, getActiveResult, isEditableSelectSql } from '../../stores/query-store'
import { useConnectionStore } from '../../stores/connection-store'
import { hasResultColumns } from '../../lib/query-result-column-utils'
import { joinClassNames } from '../../lib/class-names'

interface EditModeDropdownProps {
  tabId: string
  connectionId: string
}

type ActiveResult = ReturnType<typeof getActiveResult>

function isEditModeAvailable(result: ActiveResult, isConnectionReadOnly: boolean): boolean {
  if (result.resultStatus !== 'success') return false
  if (!hasResultColumns(result)) return false
  if (isConnectionReadOnly) return false
  return result.reExecutable && isEditableSelectSql(result.lastExecutedSql)
}

const TRIGGER_WIDTH_BOUNDS = 'min-w-29.5 max-w-45'

const ANALYZING_PULSE =
  'animate-edit-mode-load-pulse-light window-blurred:animate-edit-mode-load-pulse-light-paused dark:animate-edit-mode-load-pulse-dark dark:window-blurred:animate-edit-mode-load-pulse-dark-paused'

function triggerClassName(isAnalyzingQuery: boolean): string {
  if (isAnalyzingQuery) return joinClassNames([TRIGGER_WIDTH_BOUNDS, ANALYZING_PULSE])
  return TRIGGER_WIDTH_BOUNDS
}

type DetectedTable = ActiveResult['editTableMetadata'][string]

function useEditModeOptions(detectedTables: DetectedTable[]): DropdownOption[] {
  return useMemo(() => {
    const databases = new Set(detectedTables.map((table) => table.database))
    const needsPrefix = databases.size > 1
    const tableOptions = detectedTables.map((table) => ({
      value: `${table.database}.${table.table}`,
      label: needsPrefix ? `${table.database}.${table.table}` : table.table,
    }))
    return [{ value: '', label: 'Read only' }, ...tableOptions]
  }, [detectedTables])
}

export function EditModeDropdown({ tabId, connectionId }: EditModeDropdownProps) {
  const activeResult = useQueryStore((state) => getActiveResult(state.tabs[tabId]))
  const setEditMode = useQueryStore((state) => state.setEditMode)
  const requestNavigationAction = useQueryStore((state) => state.requestNavigationAction)

  const isConnectionReadOnly = useConnectionStore(
    (state) => state.activeConnections[connectionId]?.profile?.readOnly ?? false
  )

  const detectedTables = Object.values(activeResult.editTableMetadata)
  const isAnalyzingQuery = activeResult.isAnalyzingQuery
  const editMode = activeResult.editMode
  const editState = activeResult.editState

  const isVisible = isEditModeAvailable(activeResult, isConnectionReadOnly)

  const handleChange = useCallback(
    (value: string) => {
      const newTableName = value === '' ? null : value

      const hasUnsavedEdits = (editState?.modifiedColumns.size ?? 0) > 0
      if (hasUnsavedEdits) {
        requestNavigationAction(tabId, () => {
          setEditMode(connectionId, tabId, newTableName)
        })
        return
      }

      setEditMode(connectionId, tabId, newTableName)
    },
    [editState, requestNavigationAction, setEditMode, connectionId, tabId]
  )

  const editModeOptions = useEditModeOptions(detectedTables)

  if (!isVisible) {
    return null
  }

  return (
    <div className="flex shrink-0 items-center" data-testid="edit-mode-group">
      <Dropdown
        id={`edit-mode-dropdown-${tabId}`}
        ariaLabel="Edit mode"
        options={editModeOptions}
        value={editMode ?? ''}
        onChange={handleChange}
        disabled={isAnalyzingQuery}
        data-testid="edit-mode-dropdown"
        triggerSize="sm"
        triggerClassName={triggerClassName(isAnalyzingQuery)}
      />
    </div>
  )
}
