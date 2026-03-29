/**
 * EditModeDropdown — dropdown for selecting the edit target table
 * in query result inline editing.
 *
 * Shows "Read Only" as default, plus one option per detected table.
 * Hidden when: no result columns, query status is not success, or connection is read-only.
 */

import { useCallback, useMemo } from 'react'
import { useQueryStore, isEditableSelectSql } from '../../stores/query-store'
import { useConnectionStore } from '../../stores/connection-store'
import styles from './EditModeDropdown.module.css'

interface EditModeDropdownProps {
  tabId: string
  connectionId: string
}

export function EditModeDropdown({ tabId, connectionId }: EditModeDropdownProps) {
  const tabState = useQueryStore((state) => state.tabs[tabId])
  const setEditMode = useQueryStore((state) => state.setEditMode)
  const requestNavigationAction = useQueryStore((state) => state.requestNavigationAction)

  const activeConnection = useConnectionStore((state) => state.activeConnections[connectionId])
  const isConnectionReadOnly = activeConnection?.profile?.readOnly ?? false

  const status = tabState?.status ?? 'idle'
  const columnsCount = (tabState?.columns ?? []).length
  const editTableMetadata = tabState?.editTableMetadata ?? {}
  const detectedTables = Object.values(editTableMetadata)
  const isAnalyzingQuery = tabState?.isAnalyzingQuery ?? false
  const editMode = tabState?.editMode ?? null
  const editState = tabState?.editState ?? null
  const lastExecutedSql = tabState?.lastExecutedSql ?? null

  // Determine visibility: hidden when no columns, not success, read-only,
  // or not a SELECT/WITH query (hide for SHOW, DESCRIBE, EXPLAIN, DML, DDL)
  const isVisible =
    status === 'success' &&
    columnsCount > 0 &&
    !isConnectionReadOnly &&
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
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value
      const newTableName = value === '' ? null : value

      // If edits are pending (including unmodified active edit state), defer the change
      if (editState) {
        if (editState.modifiedColumns.size > 0) {
          requestNavigationAction(tabId, () => {
            setEditMode(connectionId, tabId, newTableName)
          })
          // Reset select to current value since the action is deferred
          e.target.value = editMode ?? ''
          return
        }
        // Unmodified edit state — just proceed (setEditMode will clean up)
      }

      setEditMode(connectionId, tabId, newTableName)
    },
    [editState, editMode, requestNavigationAction, setEditMode, connectionId, tabId]
  )

  if (!isVisible) return null

  return (
    <div className={styles.editModeGroup} data-testid="edit-mode-group">
      <select
        className={`${styles.editModeSelect} ${isAnalyzingQuery ? styles.editModeLoading : ''}`}
        value={editMode ?? ''}
        onChange={handleChange}
        disabled={isAnalyzingQuery}
        data-testid="edit-mode-dropdown"
        aria-label="Edit mode"
      >
        <option value="">Read Only</option>
        {tableOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
