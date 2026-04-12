/**
 * EditModeDropdown — dropdown for selecting the edit target table
 * in query result inline editing.
 *
 * Shows "Read Only" as default, plus one option per detected table.
 * Hidden when: no result columns, query status is not success, connection is read-only,
 * or result is not re-executable (stored procedure results).
 */

import { useCallback, useMemo } from 'react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { useQueryStore, getActiveResult, isEditableSelectSql } from '../../stores/query-store'
import { useConnectionStore } from '../../stores/connection-store'
import type { QueryTableEditInfo } from '../../types/schema'
import styles from './EditModeDropdown.module.css'

interface EditModeDropdownProps {
  tabId: string
  connectionId: string
}

export function EditModeDropdown({ tabId, connectionId }: EditModeDropdownProps) {
  const activeResult = useQueryStore((state) => getActiveResult(state.tabs[tabId]))
  const setEditMode = useQueryStore((state) => state.setEditMode)
  const requestNavigationAction = useQueryStore((state) => state.requestNavigationAction)

  const activeConnection = useConnectionStore((state) => state.activeConnections[connectionId])
  const isConnectionReadOnly = activeConnection?.profile?.readOnly ?? false

  const status = activeResult.resultStatus
  const columnsCount = activeResult.columns.length
  const editTableMetadata = activeResult.editTableMetadata ?? {}
  const detectedTables = Object.values(editTableMetadata) as QueryTableEditInfo[]
  const isAnalyzingQuery = activeResult.isAnalyzingQuery
  const editMode = activeResult.editMode
  const editState = activeResult.editState
  const lastExecutedSql = activeResult.lastExecutedSql
  const reExecutable = activeResult.reExecutable

  // Determine visibility: hidden when no columns, not success, read-only,
  // not a SELECT/WITH query, or not re-executable
  const isVisible =
    status === 'success' &&
    columnsCount > 0 &&
    !isConnectionReadOnly &&
    reExecutable &&
    isEditableSelectSql(lastExecutedSql)

  // Determine if table names need database prefix (when tables from multiple databases)
  const tableOptions = useMemo(() => {
    if (detectedTables.length === 0) return []

    const databases = new Set(detectedTables.map((t) => t.database))
    const needsPrefix = databases.size > 1

    return detectedTables.map((t) => ({
      value: `${t.database}.${t.table}`,
      label: needsPrefix ? `${t.database}.${t.table}` : t.table,
    }))
  }, [detectedTables])

  const handleChange = useCallback(
    (value: string) => {
      const newTableName = value === '' ? null : value

      if (editState) {
        if (editState.modifiedColumns.size > 0) {
          requestNavigationAction(tabId, () => {
            setEditMode(connectionId, tabId, newTableName)
          })
          return
        }
      }

      setEditMode(connectionId, tabId, newTableName)
    },
    [editState, requestNavigationAction, setEditMode, connectionId, tabId]
  )

  const editModeOptions: DropdownOption[] = useMemo(
    () => [
      { value: '', label: 'Read Only' },
      ...tableOptions.map((opt) => ({ value: opt.value, label: opt.label })),
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
        triggerClassName={`${styles.editModeSelect} ${isAnalyzingQuery ? styles.editModeLoading : ''}`}
      />
    </div>
  )
}
