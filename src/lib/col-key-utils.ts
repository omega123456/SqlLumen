/**
 * Shared utilities for the col_N key protocol used by query-result wrappers.
 *
 * Query-result grids/forms use positional `col_0`, `col_1`, … keys to map
 * between array-of-arrays row data and the keyed objects that BaseGridView /
 * BaseFormView expect.  The helpers here eliminate repeated string building,
 * parsing, and lookup-map construction across ResultGridView and ResultFormView.
 */

import type { TableDataColumnMeta } from '../types/schema'

// ---------------------------------------------------------------------------
// col_N key helpers
// ---------------------------------------------------------------------------

/** Build a positional column key: `col_0`, `col_1`, … */
export function colKey(index: number): string {
  return `col_${index}`
}

/** Parse the column index back from a `col_N` key. */
export function colIndexFromKey(key: string): number {
  return parseInt(key.replace('col_', ''), 10)
}

// ---------------------------------------------------------------------------
// TableDataColumnMeta lookup map
// ---------------------------------------------------------------------------

/**
 * Build a case-insensitive lookup map from column name → TableDataColumnMeta.
 *
 * Used by both ResultGridView and ResultFormView to enrich GridColumnDescriptor
 * entries with metadata from the edit table (nullable, PK, enum values, etc.).
 */
export function buildTableColLookup(
  editTableColumns: TableDataColumnMeta[]
): Map<string, TableDataColumnMeta> {
  const map = new Map<string, TableDataColumnMeta>()
  for (const tc of editTableColumns) {
    map.set(tc.name.toLowerCase(), tc)
  }
  return map
}
