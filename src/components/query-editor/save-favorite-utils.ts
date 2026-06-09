import type { FavoriteEntry } from '../../types/schema'
import { splitStatements, findStatementAtCursor, cursorToOffset } from './sql-parser-utils'

/**
 * Resolve the SQL to pre-populate when saving a favorite from the editor.
 * Priority: non-empty selection → statement under the cursor → whole document.
 */
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

/** Build a blank favorite entry pre-filled with SQL to open the dialog in create mode. */
export function buildFavoriteDraft(sqlText: string, connectionId: string | null): FavoriteEntry {
  return {
    id: 0,
    name: '',
    sqlText,
    description: null,
    category: null,
    connectionId,
    createdAt: '',
    updatedAt: '',
  }
}
