/**
 * Toolbar above the Monaco editor with Execute, Execute All, Save, Open,
 * History (placeholder), and Format actions.
 */

import { useState } from 'react'
import {
  Play,
  FastForward,
  FloppyDisk,
  FolderOpen,
  ClockCounterClockwise,
  MagicWand,
} from '@phosphor-icons/react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { format as formatSQL } from 'sql-formatter'
import { useQueryStore } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { readFile, writeFile } from '../../lib/query-commands'
import { splitStatements, findStatementAtCursor, cursorToOffset } from './sql-parser-utils'
import styles from './EditorToolbar.module.css'

interface EditorToolbarProps {
  connectionId: string
  tabId: string
  /** Current cursor position from Monaco (line + column, 1-indexed) */
  cursorLine: number
  cursorColumn: number
}

export function EditorToolbar({
  connectionId,
  tabId,
  cursorLine,
  cursorColumn,
}: EditorToolbarProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [isOpening, setIsOpening] = useState(false)

  const content = useQueryStore((state) => state.tabs[tabId]?.content ?? '')
  const status = useQueryStore((state) => state.tabs[tabId]?.status ?? 'idle')
  const setContent = useQueryStore((state) => state.setContent)
  const setFilePath = useQueryStore((state) => state.setFilePath)
  const executeQuery = useQueryStore((state) => state.executeQuery)
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  const isRunning = status === 'running'

  // Execute the statement at the current cursor position
  async function handleExecute() {
    if (isRunning || !content.trim()) return
    const offset = cursorToOffset(content, cursorLine, cursorColumn)
    const statements = splitStatements(content)
    const stmt = findStatementAtCursor(statements, offset)
    const sql = stmt?.sql ?? content.trim()
    if (sql) {
      await executeQuery(connectionId, tabId, sql)
    }
  }

  // Execute all statements in the editor sequentially
  async function handleExecuteAll() {
    if (isRunning || !content.trim()) return
    const statements = splitStatements(content)
    for (const stmt of statements) {
      if (!stmt.sql.trim()) continue
      // Skip DELIMITER directives themselves
      if (/^DELIMITER\s/i.test(stmt.sql.trim())) continue
      await executeQuery(connectionId, tabId, stmt.sql)
      // Check if tab was closed mid-execution or last execution errored
      const tabState = useQueryStore.getState().tabs[tabId]
      if (!tabState) break // Tab was closed
      if (tabState.status === 'error') break
    }
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
    } catch {
      // User cancelled or error — no-op
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
    } catch {
      // User cancelled or error — no-op
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
    } catch {
      // Format error — no-op, keep original content
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
          disabled={isSaving}
          data-testid="toolbar-save"
        >
          <FloppyDisk size={16} weight="regular" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          title="Open SQL file"
          onClick={handleOpen}
          disabled={isOpening}
          data-testid="toolbar-open"
        >
          <FolderOpen size={16} weight="regular" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          title="History (coming soon)"
          disabled
          aria-disabled="true"
          data-testid="toolbar-history"
        >
          <ClockCounterClockwise size={16} weight="regular" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          title="Format SQL"
          onClick={handleFormat}
          data-testid="toolbar-format"
        >
          <MagicWand size={16} weight="regular" />
        </button>
      </div>

      {/* Right: execute buttons */}
      <div className={styles.rightActions}>
        <button
          type="button"
          className={`${styles.executeButton} ${styles.executeAll}`}
          onClick={handleExecuteAll}
          disabled={isRunning || !content.trim()}
          data-testid="toolbar-execute-all"
        >
          <FastForward size={14} weight="fill" />
          <span>Execute All</span>
        </button>
        <button
          type="button"
          className={`${styles.executeButton} ${styles.executePrimary}`}
          onClick={handleExecute}
          disabled={isRunning || !content.trim()}
          data-testid="toolbar-execute"
        >
          {isRunning ? (
            <span className={styles.spinner} aria-label="Running..." />
          ) : (
            <Play size={14} weight="fill" />
          )}
          <span>Execute Query</span>
        </button>
      </div>
    </div>
  )
}
