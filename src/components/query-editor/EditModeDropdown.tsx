import { useCallback, useMemo } from 'react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { useQueryStore, getActiveResult, isEditableSelectSql } from '../../stores/query-store'
import { useConnectionStore } from '../../stores/connection-store'
import styles from './EditModeDropdown.module.css'
import { hasResultColumns } from '../../lib/query-result-column-utils'

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

function editModeTriggerClassName(isAnalyzingQuery: boolean): string {
  if (!isAnalyzingQuery) return `${styles.editModeSelect} `
  return `${styles.editModeSelect} ${styles.editModeLoading}`
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

  const tableOptions = useMemo(() => {
    if (detectedTables.length === 0) return []

    const databases = new Set(detectedTables.map((table) => table.database))
    const needsPrefix = databases.size > 1

    return detectedTables.map((table) => ({
      value: `${table.database}.${table.table}`,
      label: needsPrefix ? `${table.database}.${table.table}` : table.table,
    }))
  }, [detectedTables])

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

  const editModeOptions: DropdownOption[] = useMemo(
    () => [
      { value: '', label: 'Read only' },
      ...tableOptions.map((option) => ({ value: option.value, label: option.label })),
    ],
    [tableOptions]
  )

  if (!isVisible) {
    return null
  }

  return (
    <div className={styles.editModeGroup} data-testid="edit-mode-group">
      <Dropdown
        id={`edit-mode-dropdown-${tabId}`}
        ariaLabel="Edit mode"
        options={editModeOptions}
        value={editMode ?? ''}
        onChange={handleChange}
        disabled={isAnalyzingQuery}
        data-testid="edit-mode-dropdown"
        triggerClassName={editModeTriggerClassName(isAnalyzingQuery)}
      />
    </div>
  )
}
