import type { FavoriteEntry } from '../../types/schema'
import { splitStatements, findStatementAtCursor, cursorToOffset } from './sql-parser-utils'

export function resolveFavoriteSql(
  fullText: string,
  selectedText: string,
  cursor: { lineNumber: number; column: number } | null
): string {
  const trimmedSelection = selectedText.trim()
  if (trimmedSelection) {
    return trimmedSelection
  }

  if (cursor) {
    const offset = cursorToOffset(fullText, cursor.lineNumber, cursor.column)
    const statement = findStatementAtCursor(splitStatements(fullText), offset)
    const trimmedStatement = statement?.sql.trim()
    if (trimmedStatement) {
      return trimmedStatement
    }
  }

  return fullText.trim()
}

export function buildFavoriteDraft(sqlText: string, connectionId: string | null): FavoriteEntry {
  return {
    id: 0,
    name: '',
    sqlText: sqlText,
    description: null,
    category: null,
    connectionId: connectionId,
    createdAt: '',
    updatedAt: '',
  }
}
