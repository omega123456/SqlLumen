import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { useQueryStore } from '../../../stores/query-store'
import { readFile } from '../../../lib/query-commands'
import { splitStatements } from '../sql-parser-utils'

const SQL_FILE_FILTERS = [{ name: 'SQL files', extensions: ['sql'] }]
const DEFAULT_SAVE_FILE_NAME = 'query.sql'
const PATH_SEPARATOR_PATTERN = /[\\/]/
const DELIMITER_DIRECTIVE_PATTERN = /^DELIMITER\s/i

export function executableStatements(content: string): string[] {
  return splitStatements(content)
    .map((statement) => statement.sql.trim())
    .filter((sql) => sql.length > 0)
    .filter((sql) => !DELIMITER_DIRECTIVE_PATTERN.test(sql))
}

export async function pickSqlFileToOpen(): Promise<string | null> {
  const result = await openDialog({ filters: SQL_FILE_FILTERS, multiple: false })
  const path = Array.isArray(result) ? result[0] : result
  if (!path) return null
  return path
}

export async function pickSqlFileToSave(): Promise<string | null> {
  return saveDialog({ filters: SQL_FILE_FILTERS, defaultPath: DEFAULT_SAVE_FILE_NAME })
}

export function fileNameOf(path: string): string {
  return path.split(PATH_SEPARATOR_PATTERN).pop() ?? path
}

export async function loadSqlFileIntoNewTab(
  path: string,
  openQueryTab: (fileName: string) => string
): Promise<void> {
  const fileContent = await readFile(path)
  const newTabId = openQueryTab(fileNameOf(path))
  if (!newTabId) return
  useQueryStore.getState().setContent(newTabId, fileContent)
  useQueryStore.getState().setFilePath(newTabId, path)
}
