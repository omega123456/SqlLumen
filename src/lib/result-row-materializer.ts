/**
 * Turns windowed query-result rows (array-of-arrays from the page cache) into
 * the `{ __rowIdx, __baseIdx, col_N }` objects the shared grid expects.
 *
 * Rows are materialized one page row at a time, on demand, as the grid reads
 * them. Objects are reused by **base index**: a row keeps its object while its
 * cached row array, its view position and the column count are unchanged. A
 * saved edit replaces only that row's array in the page cache, so a repaint
 * after a commit allocates one object instead of one per row.
 *
 * - `__rowIdx` is the row's **view position** (what the grid indexes by).
 * - `__baseIdx` is the row's stable **base index** in the Rust cache
 *   (`-1` for the virtual clone-draft row).
 */

import { colKey } from './col-key-utils'

/** Row data shape: col_0, col_1, ... plus __rowIdx / __baseIdx for stable identification. */
export type ResultRow = Record<string, unknown>

/**
 * Upper bound on remembered objects. The page cache holds at most about 5,000
 * rows per result, so this keeps every loaded row reusable without growing.
 */
export const MATERIALIZER_MAX_ENTRIES = 6_000

export interface WindowRowMaterializer {
  /**
   * The object for `row` at view `position` with base index `baseIndex`,
   * reusing the previous object when nothing it depends on changed.
   */
  get: (position: number, baseIndex: number, row: readonly unknown[]) => ResultRow
  /** Forget every remembered object (e.g. the columns or the query changed). */
  reset: (columnCount: number) => void
}

interface Entry {
  row: readonly unknown[]
  position: number
  object: ResultRow
}

/** Build one row object. Missing cells become `null`. */
export function materializeRow(
  position: number,
  baseIndex: number,
  row: readonly unknown[],
  columnCount: number
): ResultRow {
  const obj: ResultRow = { __rowIdx: position, __baseIdx: baseIndex }
  for (let i = 0; i < columnCount; i++) {
    obj[colKey(i)] = row[i] ?? null
  }
  return obj
}

/**
 * Rebuild a cached row (array plus base index) from a materialized row object.
 * Objects without a base index (e.g. the clone draft) get `-1`.
 */
export function toCachedRow(
  rowData: Record<string, unknown>,
  columnCount: number
): { row: unknown[]; baseIndex: number } {
  const baseIndex = typeof rowData.__baseIdx === 'number' ? rowData.__baseIdx : -1
  return {
    row: Array.from({ length: columnCount }, (_, index) => rowData[colKey(index)] ?? null),
    baseIndex,
  }
}

export function createWindowRowMaterializer(initialColumnCount = 0): WindowRowMaterializer {
  let columnCount = initialColumnCount
  let entries = new Map<number, Entry>()

  return {
    get(position, baseIndex, row) {
      const previous = entries.get(baseIndex)
      if (previous && previous.row === row && previous.position === position) {
        return previous.object
      }
      const object = materializeRow(position, baseIndex, row, columnCount)
      if (!previous && entries.size >= MATERIALIZER_MAX_ENTRIES) {
        // Bounded: start over rather than track LRU order per row.
        entries = new Map()
      }
      entries.set(baseIndex, { row, position, object })
      return object
    },
    reset(nextColumnCount) {
      columnCount = nextColumnCount
      entries = new Map()
    },
  }
}
