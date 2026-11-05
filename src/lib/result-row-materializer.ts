/**
 * Turns query-result rows (array-of-arrays) into the `{ __rowIdx, col_N }`
 * objects the shared grid expects, reusing objects between renders.
 *
 * Saving an edited cell replaces only that row's array in the store, so a
 * rebuild after a commit allocates one object instead of one per row.
 */

import { colKey } from './col-key-utils'

/** Row data shape: col_0, col_1, ... plus __rowIdx for stable identification. */
export type ResultRow = Record<string, unknown>

export interface RowObjectCache {
  /**
   * Materialize `rows`, reusing the previous object at index `i` when
   * `rows[i]` is the same array as last time and the column count is unchanged.
   */
  build: (rows: readonly unknown[][], columnCount: number) => ResultRow[]
}

export function createRowObjectCache(): RowObjectCache {
  let prevRows: readonly unknown[][] = []
  let prevObjects: ResultRow[] = []
  let prevColumnCount = -1

  return {
    build(rows, columnCount) {
      const canReuse = columnCount === prevColumnCount
      if (canReuse && rows === prevRows) return prevObjects

      const objects = new Array<ResultRow>(rows.length)
      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx]
        if (canReuse && prevRows[rowIdx] === row) {
          objects[rowIdx] = prevObjects[rowIdx]
          continue
        }
        const obj: ResultRow = { __rowIdx: rowIdx }
        for (let i = 0; i < columnCount; i++) {
          obj[colKey(i)] = row[i] ?? null
        }
        objects[rowIdx] = obj
      }

      prevRows = rows
      prevObjects = objects
      prevColumnCount = columnCount
      return objects
    },
  }
}
