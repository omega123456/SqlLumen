import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../types/schema'

/**
 * Returns lowercased column names that appear more than once in the result columns.
 * Used to detect ambiguous columns from JOINs or subqueries.
 */
export function findAmbiguousColumns(columns: ColumnMeta[]): Set<string> {
  const counts = new Map<string, number>()
  for (const col of columns) {
    const lower = col.name.toLowerCase()
    counts.set(lower, (counts.get(lower) ?? 0) + 1)
  }
  const ambiguous = new Set<string>()
  for (const [name, count] of counts) {
    if (count > 1) {
      ambiguous.add(name)
    }
  }
  return ambiguous
}

/**
 * For a selected table, maps result column indices to whether they are editable.
 * A column is editable if:
 *  - Its name matches a table column name (case-insensitive)
 *  - It is NOT in ambiguousNames
 *  - The matched table column is NOT binary/blob
 */
export function buildEditableColumnMap(
  resultColumns: ColumnMeta[],
  tableColumns: TableDataColumnMeta[],
  ambiguousNames: Set<string>
): Map<number, boolean> {
  const map = new Map<number, boolean>()

  // Build lookup from lowercased table column name → meta
  const tableColLookup = new Map<string, TableDataColumnMeta>()
  for (const tc of tableColumns) {
    tableColLookup.set(tc.name.toLowerCase(), tc)
  }

  for (let i = 0; i < resultColumns.length; i++) {
    const colNameLower = resultColumns[i].name.toLowerCase()

    // Ambiguous columns can't be reliably mapped to a single source
    if (ambiguousNames.has(colNameLower)) {
      map.set(i, false)
      continue
    }

    // Must match a column in the target table
    const tableCol = tableColLookup.get(colNameLower)
    if (!tableCol) {
      map.set(i, false)
      continue
    }

    // Binary/blob columns aren't editable inline
    if (tableCol.isBinary) {
      map.set(i, false)
      continue
    }

    map.set(i, true)
  }

  return map
}

/**
 * Validates that all PK/unique key columns are present AND non-ambiguous
 * in the result set.
 */
export function validateKeyColumnsPresent(
  pkColumns: string[],
  resultColumns: ColumnMeta[],
  ambiguousNames: Set<string>
): { valid: boolean; missingColumns: string[] } {
  const resultColNamesLower = new Set(resultColumns.map((c) => c.name.toLowerCase()))
  const missingColumns: string[] = []

  for (const pk of pkColumns) {
    const pkLower = pk.toLowerCase()
    if (!resultColNamesLower.has(pkLower) || ambiguousNames.has(pkLower)) {
      missingColumns.push(pk)
    }
  }

  return {
    valid: missingColumns.length === 0,
    missingColumns,
  }
}

/**
 * Builds a RowEditState from a positional row array.
 * Extracts values by column index, keyed by real column name.
 * Only captures values for columns that are in the editableMap.
 */
export function buildRowEditState(
  row: unknown[],
  resultColumns: ColumnMeta[],
  editableMap: Map<number, boolean>,
  pkColumnNames: string[]
): RowEditState {
  const originalValues: Record<string, unknown> = {}
  const currentValues: Record<string, unknown> = {}
  const rowKey: Record<string, unknown> = {}

  for (let i = 0; i < resultColumns.length; i++) {
    const colName = resultColumns[i].name
    if (editableMap.get(i)) {
      originalValues[colName] = row[i]
      currentValues[colName] = row[i]
    }
  }

  // Build rowKey from PK columns (always populated, regardless of editability)
  for (const pkCol of pkColumnNames) {
    const idx = resultColumns.findIndex((c) => c.name.toLowerCase() === pkCol.toLowerCase())
    if (idx !== -1) {
      rowKey[pkCol] = row[idx]
    }
  }

  return {
    rowKey,
    originalValues,
    currentValues,
    modifiedColumns: new Set<string>(),
    isNewRow: false,
  }
}

/**
 * Builds the update_table_row payload from edit state.
 * Only modified columns appear in updatedValues.
 * PK values come from rowKey (original identity).
 */
export function buildUpdatePayload(
  editState: RowEditState,
  pkColumnNames: string[]
): {
  pkColumns: string[]
  originalPkValues: Record<string, unknown>
  updatedValues: Record<string, unknown>
} {
  const originalPkValues: Record<string, unknown> = {}
  for (const pk of pkColumnNames) {
    originalPkValues[pk] = editState.rowKey[pk]
  }

  const updatedValues: Record<string, unknown> = {}
  for (const col of editState.modifiedColumns) {
    updatedValues[col] = editState.currentValues[col]
  }

  return {
    pkColumns: pkColumnNames,
    originalPkValues,
    updatedValues,
  }
}
