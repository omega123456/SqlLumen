/**
 * Toolbar above the Monaco editor with Execute, Execute All, Save, Open,
 * History (placeholder), and Format actions.
 *
 * Execute actions are guarded by the query store's requestNavigationAction
 * so pending row edits trigger the unsaved changes dialog before executing.
 *
 * Execute All uses executeMultiQuery for batch execution.
 * Execute Query detects CALL statements and routes to executeCallQuery.
 */

import { useState } from 'react'
import { FastForward, FloppyDisk, FolderOpen, MagicWand, UploadSimple } from '@phosphor-icons/react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { format as formatSQL } from 'sql-formatter'
import { useQueryStore } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useImportDialogStore } from '../../stores/import-dialog-store'
import { readFile, writeFile } from '../../lib/query-commands'
import { splitStatements } from './sql-parser-utils'
import { RunningIndicator } from './RunningIndicator'
import styles from './EditorToolbar.module.css'

interface EditorToolbarProps {
  connectionId: string
  tabId: string
}

export function EditorToolbar({ connectionId, tabId }: EditorToolbarProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [isOpening, setIsOpening] = useState(false)

  const content = useQueryStore((state) => state.tabs[tabId]?.content ?? '')
  const status = useQueryStore((state) => state.tabs[tabId]?.tabStatus ?? 'idle')
  const setContent = useQueryStore((state) => state.setContent)
  const setFilePath = useQueryStore((state) => state.setFilePath)
  const executeMultiQuery = useQueryStore((state) => state.executeMultiQuery)
  const requestNavigationAction = useQueryStore((state) => state.requestNavigationAction)
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  const isReadOnly =
    useConnectionStore((state) => state.activeConnections[connectionId]?.profile?.readOnly) ?? false

  const isRunning = status === 'running'
  const isAiLocked = status === 'ai-pending' || status === 'ai-reviewing'
  const isDisabled = isRunning || isAiLocked

  // Execute all statements in the editor via batch execution
  async function handleExecuteAll() {
    if (isDisabled || !content.trim()) return
    requestNavigationAction(tabId, () => {
      const statements = splitStatements(content)
      const filteredStatements = statements
        .map((stmt) => stmt.sql.trim())
        .filter((sql) => sql.length > 0)
        .filter((sql) => !/^DELIMITER\s/i.test(sql))

      if (filteredStatements.length === 0) return

      executeMultiQuery(connectionId, tabId, filteredStatements)
    })
  }

  // Save editor content to file
  async function handleSave() {
    setIsSaving(true)
    try {
      const path = await saveDialog({
        filters: [{ name: 'SQL Files', extensions: ['sql'] }],
        defaultPath: 'query.sql',
      })
      if (path) {
        await writeFile(path, content)
        setFilePath(tabId, path)
      }
    } catch (err) {
      console.warn('[editor-toolbar] save or save dialog failed:', err)
    } finally {
      setIsSaving(false)
    }
  }

  // Open a SQL file into a new query tab
  async function handleOpen() {
    setIsOpening(true)
    try {
      const result = await openDialog({
        filters: [{ name: 'SQL Files', extensions: ['sql'] }],
        multiple: false,
      })
      const path = Array.isArray(result) ? result[0] : result
      if (path) {
        const fileContent = await readFile(path)
        // Get filename from path
        const fileName = path.split(/[\\/]/).pop() ?? path
        // Open in a new tab
        const newTabId = openQueryTab(connectionId, fileName)
        if (newTabId) {
          useQueryStore.getState().setContent(newTabId, fileContent)
          useQueryStore.getState().setFilePath(newTabId, path)
        }
      }
    } catch (err) {
      console.warn('[editor-toolbar] open file or open dialog failed:', err)
    } finally {
      setIsOpening(false)
    }
  }

  // Format SQL content
  function handleFormat() {
    if (!content.trim()) return
    try {
      const formatted = formatSQL(content, { language: 'mysql', tabWidth: 2 })
      setContent(tabId, formatted)
    } catch (err) {
      console.warn('[editor-toolbar] format SQL failed:', err)
    }
  }

  // Import SQL file via file picker → open SqlImportDialog
  async function handleImportSql() {
    try {
      const result = await openDialog({
        filters: [{ name: 'SQL Files', extensions: ['sql'] }],
        multiple: false,
      })
      const path = Array.isArray(result) ? result[0] : result
      if (path) {
        useImportDialogStore.getState().openImportDialog(connectionId, path)
      }
    } catch (err) {
      console.warn('[editor-toolbar] import SQL file picker failed:', err)
    }
  }

  return (
    <div className={styles.toolbar} data-testid="editor-toolbar">
      {/* Left: icon actions */}
      <div className={styles.leftActions}>
        <button
          type="button"
          className={styles.iconButton}
          title="Save (Ctrl+S)"
          onClick={handleSave}
          disabled={isSaving || isDisabled}
          data-testid="toolbar-save"
        >
          <FloppyDisk size={16} weight="regular" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          title="Open SQL file"
          onClick={handleOpen}
          disabled={isOpening || isDisabled}
          data-testid="toolbar-open"
        >
          <FolderOpen size={16} weight="regular" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          title="Format SQL"
          onClick={handleFormat}
          disabled={isDisabled}
          data-testid="toolbar-format"
        >
          <MagicWand size={16} weight="regular" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          title={isReadOnly ? 'Import SQL (disabled for read-only connections)' : 'Import SQL'}
          onClick={handleImportSql}
          disabled={isDisabled || isReadOnly}
          data-testid="toolbar-import-sql"
        >
          <UploadSimple size={16} weight="regular" />
        </button>
      </div>

      {/* Right: execute buttons or running indicator */}
      <div className={styles.rightActions}>
        {isRunning ? (
          <RunningIndicator connectionId={connectionId} tabId={tabId} />
        ) : (
          <button
            type="button"
            className={`${styles.executeButton} ${styles.executeAll}`}
            onClick={handleExecuteAll}
            disabled={!content.trim()}
            data-testid="toolbar-execute-all"
          >
            <FastForward size={14} weight="fill" />
            <span>Execute All</span>
          </button>
        )}
      </div>
    </div>
  )
}
