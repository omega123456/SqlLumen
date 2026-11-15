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
import { SnapshotDialog } from '../dialogs/SnapshotDialog'
import { useShortcut } from '../../hooks/useShortcut'
import { useShortcutStore } from '../../stores/shortcut-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { isExecutionLocked, useQueryStore } from '../../stores/query-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useImportDialogStore } from '../../stores/import-dialog-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useSnapshotStore } from '../../stores/snapshot-store'
import { useZoomStore } from '../../stores/zoom-store'
import { useCommandPaletteStore } from '../../stores/command-palette-store'
import { useCommandPaletteRecentsStore } from '../../stores/command-palette-recents-store'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'
import { readFile } from '../../lib/query-commands'
import { revealTabInObjectBrowser } from '../../lib/object-activation'
import {
  splitStatements,
  findStatementAtCursor,
  cursorToOffset,
} from '../query-editor/sql-parser-utils'
import { buildExecuteQueryPlan, runExecuteQueryPlan } from '../../lib/query-execution-plan'
import { CommandPalette } from '../command-palette/CommandPalette'

import { logFrontend, logFrontendError } from '../../lib/app-log-commands'
import { isAiLockStatus } from '../../lib/query-tab-status'

function getExecutableStatements(sql: string): string[] {
  return splitStatements(sql)
    .map((statement) => statement.sql.trim())
    .filter((statement) => statement.length > 0)
    .filter((statement) => !/^DELIMITER\s/i.test(statement))
}

const SQL_FORMAT_OPTIONS = { language: 'mysql', tabWidth: 2 } as const
const START_OF_DOCUMENT = { lineNumber: 1, column: 1 }
const STATEMENT_DELIMITER = ';'
const SQL_FILE_FILTERS = [
  { name: 'SQL files', extensions: ['sql'] },
  { name: 'All files', extensions: ['*'] },
]
const PATH_SEPARATOR_PATTERN = /[\\/]/

type QueryTabState = ReturnType<typeof useQueryStore.getState>['tabs'][string]
type CursorPosition = QueryTabState['cursorPosition']

interface ActiveTabRef {
  connectionId: string
  tabId: string
  tabType: string | null
}

interface ActiveQueryTab {
  connectionId: string
  tabId: string
  tabState: QueryTabState
}

function getActiveTab(): ActiveTabRef | null {
  const connectionId = useConnectionStore.getState().activeTabId
  if (!connectionId) return null

  const workspaceState = useWorkspaceStore.getState()
  const tabId = workspaceState.activeTabByConnection[connectionId] ?? null
  if (!tabId) return null

  const tabs = workspaceState.tabsByConnection[connectionId] ?? []
  const tab = tabs.find((candidate) => candidate.id === tabId)
  return { connectionId: connectionId, tabId: tabId, tabType: tab?.type ?? null }
}

function getActiveTabOfType(tabType: string): ActiveTabRef | null {
  const activeTab = getActiveTab()
  if (activeTab?.tabType !== tabType) return null
  return activeTab
}

function getRunnableQueryTab(): ActiveQueryTab | null {
  const activeTab = getActiveTabOfType('query-editor')
  if (!activeTab) return null
  const tabState = useQueryStore.getState().tabs[activeTab.tabId]
  if (!tabState) return null
  if (isExecutionLocked(tabState)) return null
  const hasContent = tabState.content.trim() !== ''
  if (!hasContent) return null
  return { connectionId: activeTab.connectionId, tabId: activeTab.tabId, tabState: tabState }
}

function executeQueryAtCursor(): void {
  const queryTab = getRunnableQueryTab()
  if (!queryTab) return
  const { tabState } = queryTab
  const plan = buildExecuteQueryPlan(
    tabState.content,
    tabState.selectedText ?? '',
    tabState.cursorPosition
  )
  if (!plan) return
  runExecuteQueryPlan(useQueryStore.getState(), queryTab, plan)
}

function executeAllStatements(): void {
  const queryTab = getRunnableQueryTab()
  if (!queryTab) return
  const queryState = useQueryStore.getState()
  const { connectionId, tabId, tabState } = queryTab
  queryState.requestNavigationAction(tabId, () => {
    const statements = getExecutableStatements(tabState.content)
    if (statements.length === 0) return
    queryState.executeMultiQuery(connectionId, tabId, statements)
  })
}

function isSelectionEndingAt(content: string, selectedText: string, cursorOffset: number): boolean {
  if (cursorOffset < selectedText.length) return false
  return content.substring(cursorOffset - selectedText.length, cursorOffset) === selectedText
}

function resolveSelectionStart(
  content: string,
  selectedText: string,
  cursorOffset: number
): number {
  if (isSelectionEndingAt(content, selectedText, cursorOffset)) {
    return cursorOffset - selectedText.length
  }
  const textAfterCursor = content.substring(cursorOffset, cursorOffset + selectedText.length)
  if (textAfterCursor === selectedText) return cursorOffset
  return content.indexOf(selectedText)
}

function cursorOffsetIn(content: string, cursorPosition: CursorPosition): number {
  const cursor = cursorPosition ?? START_OF_DOCUMENT
  return cursorToOffset(content, cursor.lineNumber, cursor.column)
}

function formatSelectedText(
  content: string,
  selectedText: string,
  cursorPosition: CursorPosition
): string | null {
  const formatted = formatSQL(selectedText, SQL_FORMAT_OPTIONS)
  const cursorOffset = cursorOffsetIn(content, cursorPosition)
  const selectionStart = resolveSelectionStart(content, selectedText, cursorOffset)
  if (selectionStart === -1) return null
  return (
    content.substring(0, selectionStart) +
    formatted +
    content.substring(selectionStart + selectedText.length)
  )
}

function withoutTrailingDelimiter(formatted: string): string {
  const trimmed = formatted.trimEnd()
  if (!trimmed.endsWith(STATEMENT_DELIMITER)) return trimmed
  return trimmed.slice(0, -1).trimEnd()
}

function formatStatementAtCursor(content: string, cursorPosition: CursorPosition): string {
  const offset = cursorOffsetIn(content, cursorPosition)
  const statement = findStatementAtCursor(splitStatements(content), offset)
  if (!statement) return formatSQL(content, SQL_FORMAT_OPTIONS)

  const rangeText = content.substring(statement.start, statement.end)
  const hadTrailingDelimiter = rangeText.trimEnd().endsWith(STATEMENT_DELIMITER)
  const formatted = withoutTrailingDelimiter(formatSQL(statement.sql, SQL_FORMAT_OPTIONS))
  const finalFormatted = hadTrailingDelimiter ? formatted + STATEMENT_DELIMITER : formatted
  return content.substring(0, statement.start) + finalFormatted + content.substring(statement.end)
}

function formattedQueryContent(tabState: QueryTabState): string | null {
  const content = tabState.content ?? ''
  if (!content.trim()) return null
  const selectedText = tabState.selectedText ?? ''
  if (selectedText.length > 0) {
    return formatSelectedText(content, selectedText, tabState.cursorPosition)
  }
  return formatStatementAtCursor(content, tabState.cursorPosition)
}

function formatActiveQuery(): void {
  const activeTab = getActiveTabOfType('query-editor')
  if (!activeTab) return
  const { tabId } = activeTab
  const queryState = useQueryStore.getState()
  const tabState = queryState.tabs[tabId]
  if (!tabState) return
  if (isAiLockStatus(tabState.tabStatus)) return
  try {
    const newContent = formattedQueryContent(tabState)
    if (newContent === null) return
    queryState.setContent(tabId, newContent)
  } catch (error) {
    logFrontend('warn', `[app-layout] Formatting the query failed: ${String(error)}`)
  }
}

function saveActiveObjectEditor(): void {
  const activeTab = getActiveTabOfType('object-editor')
  if (!activeTab) return
  const { tabId } = activeTab
  const objectStore = useObjectEditorStore.getState()
  const objectTab = objectStore.tabs[tabId]
  if (!objectTab) return
  if (objectTab.isSaving) return
  if (objectTab.content === objectTab.originalContent) return
  void objectStore.saveBody(tabId)
}

function openNewQueryTab(): void {
  const connectionId = useConnectionStore.getState().activeTabId
  if (!connectionId) return
  useWorkspaceStore.getState().openQueryTab(connectionId)
}

function closeActiveTab(): void {
  const activeTab = getActiveTab()
  if (!activeTab) return
  useWorkspaceStore.getState().closeTab(activeTab.connectionId, activeTab.tabId)
}

async function openSqlFileInNewTab(connectionId: string): Promise<void> {
  try {
    const result = await openFileDialog({ multiple: false, filters: SQL_FILE_FILTERS })
    const filePath = Array.isArray(result) ? result[0] : result
    if (!filePath) return

    const contents = await readFile(filePath)
    const fileName = filePath.split(PATH_SEPARATOR_PATTERN).pop() ?? 'Untitled'
    const tabId = useWorkspaceStore.getState().openQueryTab(connectionId, fileName)
    if (!tabId) return
    const queryState = useQueryStore.getState()
    queryState.setContent(tabId, contents)
    queryState.setFilePath(tabId, filePath)
  } catch (error) {
    logFrontendError('[app-layout] open-file failed:', error)
  }
}

function openFile(): void {
  const connectionId = useConnectionStore.getState().activeTabId
  if (!connectionId) return
  void openSqlFileInNewTab(connectionId)
}

function revealActiveTabInObjectBrowser(): void {
  const activeTab = getActiveTab()
  if (!activeTab) return
  const { connectionId, tabId } = activeTab
  const tabs = useWorkspaceStore.getState().tabsByConnection[connectionId] ?? []
  const tab = tabs.find((candidate) => candidate.id === tabId)
  if (tab) {
    void revealTabInObjectBrowser(tab)
  }
}

const APP_SHORTCUT_ACTIONS: Record<string, () => void> = {
  'execute-query': executeQueryAtCursor,
  'execute-all': executeAllStatements,
  'format-query': formatActiveQuery,
  'save-file': saveActiveObjectEditor,
  'new-query-tab': openNewQueryTab,
  'close-tab': closeActiveTab,
  'open-file': openFile,
  settings: () => useSettingsStore.getState().openDialog(),
  'zoom-in': () => void useZoomStore.getState().zoomIn(),
  'zoom-out': () => void useZoomStore.getState().zoomOut(),
  'zoom-reset': () => void useZoomStore.getState().resetZoom(),
  'command-palette': () => useCommandPaletteStore.getState().toggle(),
  'command-palette-table': () => useCommandPaletteStore.getState().toggle(true),
  'reveal-in-object-browser': revealActiveTabInObjectBrowser,
}

function useAppShortcutActions(): void {
  useEffect(() => {
    const store = useShortcutStore.getState()
    const actionEntries = Object.entries(APP_SHORTCUT_ACTIONS)
    for (const [actionId, action] of actionEntries) {
      store.registerAction(actionId, action)
    }
    return () => {
      for (const [actionId] of actionEntries) {
        store.unregisterAction(actionId)
      }
    }
  }, [])
}

function useCommandPaletteRecentsInit(): void {
  const initializeCommandPaletteRecents = useCommandPaletteRecentsStore(
    (state) => state.initializeFromBackend
  )
  useEffect(() => {
    void initializeCommandPaletteRecents()
  }, [initializeCommandPaletteRecents])
}

function MainPanels() {
  const sidebarPanelRef = usePanelRef()
  const handleSeparatorDoubleClick = () => {
    sidebarPanelRef.current?.resize('20%')
  }
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-light-surface-container dark:bg-dark-surface-container">
      <Group orientation="horizontal" className="h-full">
        <Panel
          panelRef={sidebarPanelRef}
          id="sidebar"
          defaultSize="20%"
          minSize="12%"
          maxSize="37%"
          className="overflow-hidden"
        >
          <Sidebar />
        </Panel>
        <Separator
          className={joinClassNames([
            'relative z-0 w-resize-handle shrink-0 cursor-col-resize bg-transparent transition-bg duration-150 hover:bg-light-primary resize-dragging:bg-light-primary dark:hover:bg-dark-primary dark:resize-dragging:bg-dark-primary',
            FOCUS_RING,
          ])}
          onDoubleClick={handleSeparatorDoubleClick}
        />
        <Panel id="workspace" className="min-h-0" style={{ overflow: 'visible' }}>
          <WorkspaceArea />
        </Panel>
      </Group>
    </div>
  )
}

function ImportDialogHost() {
  const importDialogRequest = useImportDialogStore((state) => state.request)
  const closeImportDialog = useImportDialogStore((state) => state.closeImportDialog)
  if (!importDialogRequest) return null
  return (
    <SqlImportDialog
      connectionId={importDialogRequest.connectionId}
      filePath={importDialogRequest.filePath}
      onClose={closeImportDialog}
    />
  )
}

export function AppLayout() {
  const isSettingsOpen = useSettingsStore((state) => state.isDialogOpen)
  const openSettingsDialog = useSettingsStore((state) => state.openDialog)
  const closeSettingsDialog = useSettingsStore((state) => state.closeDialog)

  useShortcut()
  useCommandPaletteRecentsInit()
  useAppShortcutActions()

  const handleOpenSettings = useCallback(() => {
    openSettingsDialog()
  }, [openSettingsDialog])

  const handleCloseSettings = useCallback(() => {
    closeSettingsDialog()
  }, [closeSettingsDialog])

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="app-layout">
      <ConnectionTabBar
        onOpenSettings={handleOpenSettings}
        onOpenSnapshots={() => useSnapshotStore.getState().openDialog()}
      />
      <MainPanels />
      <StatusBar />
      <ConnectionDialog />
      <SettingsDialog isOpen={isSettingsOpen} onClose={handleCloseSettings} />
      <SnapshotDialog />
      <CommandPalette />
      <ImportDialogHost />
      <ToastViewport />
    </div>
  )
}
