import { useCallback, useEffect } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { format as formatSQL } from 'sql-formatter'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import { ConnectionTabBar } from './ConnectionTabBar'
import { Sidebar } from './Sidebar'
import { WorkspaceArea } from './WorkspaceArea'
import { StatusBar } from './StatusBar'
import { ConnectionDialog } from '../connection-dialog/ConnectionDialog'
import { SettingsDialog } from '../settings/SettingsDialog'
import { ToastViewport } from '../common/ToastViewport'
import SqlImportDialog from '../dialogs/SqlImportDialog'
import { useShortcut } from '../../hooks/useShortcut'
import { useShortcutStore } from '../../stores/shortcut-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useImportDialogStore } from '../../stores/import-dialog-store'
import { useSettingsStore } from '../../stores/settings-store'
import { readFile } from '../../lib/query-commands'
import {
  splitStatements,
  findStatementAtCursor,
  cursorToOffset,
} from '../query-editor/sql-parser-utils'
import { buildExecuteQueryPlan, runExecuteQueryPlan } from '../../lib/query-execution-plan'
import styles from './AppLayout.module.css'

import { logFrontend } from '../../lib/app-log-commands'

function getExecutableStatements(sql: string): string[] {
  return splitStatements(sql)
    .map((statement) => statement.sql.trim())
    .filter((statement) => statement.length > 0)
    .filter((statement) => !/^DELIMITER\s/i.test(statement))
}

export function AppLayout() {
  const sidebarPanelRef = usePanelRef()
  const isSettingsOpen = useSettingsStore((s) => s.isDialogOpen)
  const openSettingsDialog = useSettingsStore((s) => s.openDialog)
  const closeSettingsDialog = useSettingsStore((s) => s.closeDialog)
  const importDialogRequest = useImportDialogStore((s) => s.request)
  const closeImportDialog = useImportDialogStore((s) => s.closeImportDialog)

  // Activate global keyboard shortcut listener
  useShortcut()

  const handleSeparatorDoubleClick = () => {
    sidebarPanelRef.current?.resize('20%')
  }

  const handleOpenSettings = useCallback(() => {
    openSettingsDialog()
  }, [openSettingsDialog])

  const handleCloseSettings = useCallback(() => {
    closeSettingsDialog()
  }, [closeSettingsDialog])

  // Register shortcut action callbacks
  useEffect(() => {
    const store = useShortcutStore.getState()

    /** Get the active connection ID and active workspace tab for that connection. */
    function getActiveContext(): {
      connectionId: string | null
      tabId: string | null
      tabType: string | null
    } {
      const connectionId = useConnectionStore.getState().activeTabId
      if (!connectionId) return { connectionId: null, tabId: null, tabType: null }

      const workspaceState = useWorkspaceStore.getState()
      const tabId = workspaceState.activeTabByConnection[connectionId] ?? null
      if (!tabId) return { connectionId, tabId: null, tabType: null }

      const tabs = workspaceState.tabsByConnection[connectionId] ?? []
      const tab = tabs.find((t) => t.id === tabId)
      return { connectionId, tabId, tabType: tab?.type ?? null }
    }

    store.registerAction('execute-query', () => {
      const { connectionId, tabId, tabType } = getActiveContext()
      if (!connectionId || !tabId || tabType !== 'query-editor') return

      const queryState = useQueryStore.getState()
      const tabState = queryState.tabs[tabId]
      if (
        !tabState ||
        tabState.tabStatus === 'running' ||
        tabState.tabStatus === 'ai-pending' ||
        tabState.tabStatus === 'ai-reviewing'
      )
        return

      const content = tabState.content
      if (!content.trim()) return

      const plan = buildExecuteQueryPlan(
        content,
        tabState.selectedText ?? '',
        tabState.cursorPosition
      )
      if (!plan) return

      runExecuteQueryPlan(queryState, connectionId, tabId, plan)
    })

    store.registerAction('execute-all', () => {
      const { connectionId, tabId, tabType } = getActiveContext()
      if (!connectionId || !tabId || tabType !== 'query-editor') return

      const queryState = useQueryStore.getState()
      const tabState = queryState.tabs[tabId]
      if (
        !tabState ||
        tabState.tabStatus === 'running' ||
        tabState.tabStatus === 'ai-pending' ||
        tabState.tabStatus === 'ai-reviewing'
      )
        return

      const content = tabState.content
      if (!content.trim()) return

      queryState.requestNavigationAction(tabId, () => {
        const filtered = getExecutableStatements(content)

        if (filtered.length === 0) return
        queryState.executeMultiQuery(connectionId, tabId, filtered)
      })
    })

    store.registerAction('format-query', () => {
      const { tabId, tabType } = getActiveContext()
      if (!tabId) return

      if (tabType === 'query-editor') {
        const queryState = useQueryStore.getState()
        const tabState = queryState.tabs[tabId]
        if (!tabState) return

        // Block format during AI lock states
        if (tabState.tabStatus === 'ai-pending' || tabState.tabStatus === 'ai-reviewing') return

        const content = tabState.content ?? ''
        if (!content.trim()) return

        const selectedText = tabState.selectedText ?? ''
        const cursorPosition = tabState.cursorPosition

        try {
          if (selectedText.length > 0) {
            // Format only the selected text and replace it in-place
            const formatted = formatSQL(selectedText, { language: 'mysql', tabWidth: 2 })
            const cursor = cursorPosition ?? { lineNumber: 1, column: 1 }
            const cursorOffset = cursorToOffset(content, cursor.lineNumber, cursor.column)

            // The cursor is at one end of the selection — find which end
            let selectionStart: number
            if (
              cursorOffset >= selectedText.length &&
              content.substring(cursorOffset - selectedText.length, cursorOffset) === selectedText
            ) {
              // Cursor is at the end of the selection (forward selection)
              selectionStart = cursorOffset - selectedText.length
            } else if (
              content.substring(cursorOffset, cursorOffset + selectedText.length) === selectedText
            ) {
              // Cursor is at the start of the selection (backward selection)
              selectionStart = cursorOffset
            } else {
              // Fallback: search for the selected text nearest to cursor
              const idx = content.indexOf(selectedText)
              if (idx === -1) return
              selectionStart = idx
            }

            const newContent =
              content.substring(0, selectionStart) +
              formatted +
              content.substring(selectionStart + selectedText.length)
            queryState.setContent(tabId, newContent)
          } else {
            // No selection — format only the statement at cursor
            const cursor = cursorPosition ?? { lineNumber: 1, column: 1 }
            const offset = cursorToOffset(content, cursor.lineNumber, cursor.column)
            const statements = splitStatements(content)
            const statementAtCursor = findStatementAtCursor(statements, offset)

            if (statementAtCursor) {
              const formatted = formatSQL(statementAtCursor.sql, { language: 'mysql', tabWidth: 2 })
              // Replace the statement range in the original content, preserving surrounding text
              const before = content.substring(0, statementAtCursor.start)
              // The end offset includes the delimiter; we want to replace only the statement text
              // but keep any trailing delimiter. The `end` includes the delimiter character(s).
              // We replace from start to just the statement text length (start + sql original span).
              // Actually, statementAtCursor.end includes the delimiter, and statementAtCursor.sql
              // is the trimmed text. We need to replace the full range [start, end) which includes
              // the delimiter, but re-append a semicolon after the formatted text.
              const after = content.substring(statementAtCursor.end)
              // Determine if there was a trailing delimiter (semicolon) in the original range
              const rangeText = content.substring(statementAtCursor.start, statementAtCursor.end)
              const hadTrailingDelimiter = rangeText.trimEnd().endsWith(';')
              const formattedTrimmed = formatted.trimEnd()
              // sql-formatter may add its own trailing semicolons or not — normalize
              const formattedWithoutTrailingSemicolon = formattedTrimmed.endsWith(';')
                ? formattedTrimmed.slice(0, -1).trimEnd()
                : formattedTrimmed
              const finalFormatted = hadTrailingDelimiter
                ? formattedWithoutTrailingSemicolon + ';'
                : formattedWithoutTrailingSemicolon
              const newContent = before + finalFormatted + after
              queryState.setContent(tabId, newContent)
            } else {
              // Fallback: format entire content
              const formatted = formatSQL(content, { language: 'mysql', tabWidth: 2 })
              queryState.setContent(tabId, formatted)
            }
          }
        } catch {
          // format failed — ignore
        }
      }
    })

    store.registerAction('save-file', () => {
      const { tabId, tabType } = getActiveContext()
      if (!tabId) return

      if (tabType === 'object-editor') {
        const objStore = useObjectEditorStore.getState()
        const objTab = objStore.tabs[tabId]
        if (objTab && objTab.content !== objTab.originalContent && !objTab.isSaving) {
          void objStore.saveBody(tabId)
        }
      }
      // For query-editor tabs, save-file is handled by the EditorToolbar button
      // (requires native file dialog which must be triggered from a user click handler)
    })

    store.registerAction('new-query-tab', () => {
      const connectionId = useConnectionStore.getState().activeTabId
      if (!connectionId) return
      useWorkspaceStore.getState().openQueryTab(connectionId)
    })

    store.registerAction('close-tab', () => {
      const { connectionId, tabId } = getActiveContext()
      if (!connectionId || !tabId) return
      useWorkspaceStore.getState().closeTab(connectionId, tabId)
    })

    store.registerAction('open-file', () => {
      const connectionId = useConnectionStore.getState().activeTabId
      if (!connectionId) return

      void (async () => {
        try {
          const result = await openFileDialog({
            multiple: false,
            filters: [
              { name: 'SQL Files', extensions: ['sql'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          })
          const filePath = Array.isArray(result) ? result[0] : result
          if (!filePath) return

          const contents = await readFile(filePath)
          const fileName = filePath.split(/[\\/]/).pop() ?? 'Untitled'
          const tabId = useWorkspaceStore.getState().openQueryTab(connectionId, fileName)
          if (tabId) {
            const queryState = useQueryStore.getState()
            queryState.setContent(tabId, contents)
            queryState.setFilePath(tabId, filePath)
          }
        } catch (err) {
          logFrontend('error', ['[app-layout] open-file failed:', err].map(String).join(' '))
        }
      })()
    })

    store.registerAction('settings', () => {
      useSettingsStore.getState().openDialog()
    })

    return () => {
      store.unregisterAction('execute-query')
      store.unregisterAction('execute-all')
      store.unregisterAction('format-query')
      store.unregisterAction('save-file')
      store.unregisterAction('new-query-tab')
      store.unregisterAction('close-tab')
      store.unregisterAction('open-file')
      store.unregisterAction('settings')
    }
  }, [])

  return (
    <div className={styles.appLayout} data-testid="app-layout">
      <ConnectionTabBar onOpenSettings={handleOpenSettings} />
      <div className={styles.mainContent}>
        <Group orientation="horizontal" className={styles.panelGroup}>
          <Panel
            panelRef={sidebarPanelRef}
            id="sidebar"
            defaultSize="20%"
            minSize="12%"
            maxSize="37%"
            className={styles.sidebarPanel}
          >
            <Sidebar />
          </Panel>
          <Separator className={styles.resizeHandle} onDoubleClick={handleSeparatorDoubleClick} />
          <Panel
            id="workspace"
            className={styles.workspacePanel}
            /* Let workspace tab rail extend over the resize gutter (default Panel inner overflow:auto clips it) */
            style={{ overflow: 'visible' }}
          >
            <WorkspaceArea />
          </Panel>
        </Group>
      </div>
      <StatusBar />
      <ConnectionDialog />
      <SettingsDialog isOpen={isSettingsOpen} onClose={handleCloseSettings} />
      {importDialogRequest && (
        <SqlImportDialog
          connectionId={importDialogRequest.connectionId}
          filePath={importDialogRequest.filePath}
          onClose={closeImportDialog}
        />
      )}
      <ToastViewport />
    </div>
  )
}
