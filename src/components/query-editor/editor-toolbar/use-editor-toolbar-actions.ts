import { useState } from 'react'
import { format as formatSQL } from 'sql-formatter'
import { logFrontendWarning } from '../../../lib/app-log-commands'
import { useQueryStore, type RunTarget } from '../../../stores/query-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useImportDialogStore } from '../../../stores/import-dialog-store'
import { writeFile } from '../../../lib/query-commands'
import {
  executableStatements,
  loadSqlFileIntoNewTab,
  pickSqlFileToOpen,
  pickSqlFileToSave,
} from './editor-file-actions'

const SQL_FORMAT_OPTIONS = { language: 'mysql', tabWidth: 2 } as const

export interface EditorToolbarTarget {
  connectionId: string
  tabId: string
  content: string
  isDisabled: boolean
}

function useRunAllStatements({ connectionId, tabId, content, isDisabled }: EditorToolbarTarget) {
  const requestNavigationAction = useQueryStore((state) => state.requestNavigationAction)
  return function runAllStatements(run: (target: RunTarget) => void) {
    if (isDisabled) return
    if (!content.trim()) return
    requestNavigationAction(tabId, () => {
      const statements = executableStatements(content)
      if (statements.length === 0) return
      run({ connectionId: connectionId, tabId: tabId, statements: statements })
    })
  }
}

function useExecuteAll(target: EditorToolbarTarget) {
  const executeMultiQuery = useQueryStore((state) => state.executeMultiQuery)
  const runAllStatements = useRunAllStatements(target)
  return function handleExecuteAll() {
    runAllStatements(({ connectionId, tabId, statements }) => {
      void executeMultiQuery(connectionId, tabId, statements)
    })
  }
}

function useExecuteAllAndCopyPath(target: EditorToolbarTarget) {
  const executeAllAndCopyResultPath = useQueryStore((state) => state.executeAllAndCopyResultPath)
  const runAllStatements = useRunAllStatements(target)
  return function handleExecuteAllAndCopyPath() {
    runAllStatements((runTarget) => {
      void executeAllAndCopyResultPath(runTarget)
    })
  }
}

function useCopyLastRunPath({ tabId }: EditorToolbarTarget) {
  const copyLastRunFilePath = useQueryStore((state) => state.copyLastRunFilePath)
  const lastRunFilePath = useQueryStore(
    (state) => state.tabs[tabId]?.runExport?.runFilePath ?? null
  )
  return {
    hasLastRunFilePath: lastRunFilePath !== null,
    handleCopyLastRunPath: () => void copyLastRunFilePath(tabId),
  }
}

function useSaveToFile({ tabId, content }: EditorToolbarTarget) {
  const setFilePath = useQueryStore((state) => state.setFilePath)
  const [isSaving, setIsSaving] = useState(false)
  async function handleSave() {
    setIsSaving(true)
    try {
      const path = await pickSqlFileToSave()
      if (!path) return
      await writeFile(path, content)
      setFilePath(tabId, path)
    } catch (error) {
      logFrontendWarning('[editor-toolbar] save or save dialog failed:', error)
    } finally {
      setIsSaving(false)
    }
  }
  return { isSaving, handleSave }
}

function useOpenFile({ connectionId }: EditorToolbarTarget) {
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)
  const [isOpening, setIsOpening] = useState(false)
  async function handleOpen() {
    setIsOpening(true)
    try {
      const path = await pickSqlFileToOpen()
      if (!path) return
      await loadSqlFileIntoNewTab(path, (fileName) => openQueryTab(connectionId, fileName))
    } catch (error) {
      logFrontendWarning('[editor-toolbar] open file or open dialog failed:', error)
    } finally {
      setIsOpening(false)
    }
  }
  return { isOpening, handleOpen }
}

function useFormatContent({ tabId, content }: EditorToolbarTarget) {
  const setContent = useQueryStore((state) => state.setContent)
  return function handleFormat() {
    if (!content.trim()) return
    try {
      setContent(tabId, formatSQL(content, SQL_FORMAT_OPTIONS))
    } catch (error) {
      logFrontendWarning('[editor-toolbar] format SQL failed:', error)
    }
  }
}

async function handleImportSql(connectionId: string) {
  try {
    const path = await pickSqlFileToOpen()
    if (!path) return
    useImportDialogStore.getState().openImportDialog(connectionId, path)
  } catch (error) {
    logFrontendWarning('[editor-toolbar] import SQL file picker failed:', error)
  }
}

export function useEditorToolbarActions(target: EditorToolbarTarget) {
  return {
    handleExecuteAll: useExecuteAll(target),
    handleExecuteAllAndCopyPath: useExecuteAllAndCopyPath(target),
    ...useCopyLastRunPath(target),
    ...useSaveToFile(target),
    ...useOpenFile(target),
    handleFormat: useFormatContent(target),
    handleImportSql: () => handleImportSql(target.connectionId),
  }
}
