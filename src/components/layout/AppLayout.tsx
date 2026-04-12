import { useState, useCallback, useEffect } from 'react'
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
import { useQueryStore, isCallSql } from '../../stores/query-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useImportDialogStore } from '../../stores/import-dialog-store'
import { readFile } from '../../lib/query-commands'
import {
  splitStatements,
  findStatementAtCursor,
  cursorToOffset,
} from '../query-editor/sql-parser-utils'
import styles from './AppLayout.module.css'

export function AppLayout() {
  const sidebarPanelRef = usePanelRef()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const importDialogRequest = useImportDialogStore((s) => s.request)
  const closeImportDialog = useImportDialogStore((s) => s.closeImportDialog)

  // Activate global keyboard shortcut listener
  useShortcut()

  const handleSeparatorDoubleClick = () => {
    sidebarPanelRef.current?.resize('20%')
  }

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true)
  }, [])

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false)
  }, [])

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

      const cursor = tabState.cursorPosition ?? { lineNumber: 1, column: 1 }
      const offset = cursorToOffset(content, cursor.lineNumber, cursor.column)
      const statements = splitStatements(content)
      const stmt = findStatementAtCursor(statements, offset)
      const sql = stmt?.sql ?? content.trim()

      if (sql) {
        queryState.requestNavigationAction(tabId, () => {
          if (isCallSql(sql)) {
            queryState.executeCallQuery(connectionId, tabId, sql)
          } else {
            queryState.executeQuery(connectionId, tabId, sql)
          }
        })
      }
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
        const statements = splitStatements(content)
        const filtered = statements
          .map((s) => s.sql.trim())
          .filter((sql) => sql.length > 0)
          .filter((sql) => !/^DELIMITER\s/i.test(sql))

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
        try {
          const formatted = formatSQL(content, { language: 'mysql', tabWidth: 2 })
          queryState.setContent(tabId, formatted)
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
          console.error('[app-layout] open-file failed:', err)
        }
      })()
    })

    store.registerAction('settings', () => {
      setIsSettingsOpen(true)
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
