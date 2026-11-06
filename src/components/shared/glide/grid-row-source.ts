/**
 * Row-source contract for `CanvasBaseGridView`.
 *
 * The grid reads rows only through a row source, which decouples it from a
 * concrete row array:
 * - **Array mode** (`createArrayRowSource`) wraps today's in-memory `rows`
 *   array. Table data, the process list and FK lookup keep using it unchanged.
 * - **Windowed mode** (query results) serves rows from a bounded page cache.
 *   A row that isn't loaded yet reads as `undefined`, the grid paints a
 *   skeleton for it and asks the source to load the visible range.
 */

/** Progress reported by `readRange` while it fetches missing rows. */
export interface RowSourceReadProgress {
  done: number
  total: number
}

/** Options for an async range read. */
export interface RowSourceReadOptions {
  /** Aborts the read; the promise rejects with an `AbortError`. */
  signal?: AbortSignal
  /** Called after each fetched chunk. */
  onProgress?: (progress: RowSourceReadProgress) => void
}

/** A half-open view-position range `[start, end)`. */
export type RowRange = readonly [start: number, end: number]

export interface GridRowSource<TRow> {
  /** `array` for in-memory rows, `windowed` for rows served from a page cache. */
  readonly kind: 'array' | 'windowed'
  /** Number of rows in the view. */
  readonly rowCount: number
  /** Row at a view position, or `undefined` when it isn't loaded (or out of range). */
  getRow(index: number): TRow | undefined
  /** True when the row at `index` is loaded. */
  isLoaded(index: number): boolean
  /** Windowed mode: the grid reports its visible view-position range here. */
  onVisibleRangeChange?(range: RowRange): void
  /**
   * Windowed mode: resolve every row in `[start, end)`, fetching missing rows
   * first. Rows come back in view order. Used by Copy, Cut, Clear and Paste.
   */
  readRange?(range: RowRange, options?: RowSourceReadOptions): Promise<TRow[]>
  /**
   * Windowed mode: subscribe to newly loaded ranges so the grid can repaint
   * only those cells. `reseeded` marks a re-seed (every page was dropped, for
   * example after a re-run): the grid then re-reports its visible range.
   * Returns an unsubscribe function.
   */
  subscribe?(listener: (range: RowRange, info?: { reseeded: boolean }) => void): () => void
}

/** Wrap an in-memory row array as a row source (every row is loaded). */
export function createArrayRowSource<TRow>(rows: readonly TRow[]): GridRowSource<TRow> {
  return {
    kind: 'array',
    rowCount: rows.length,
    getRow: (index) => rows[index],
    isLoaded: (index) => index >= 0 && index < rows.length,
  }
}

/** Read every row in `range` through the source, using `readRange` when rows are missing. */
export async function resolveRowRange<TRow>(
  source: GridRowSource<TRow>,
  range: RowRange,
  options?: RowSourceReadOptions
): Promise<TRow[]> {
  const [start, end] = range
  const clampedStart = Math.max(0, start)
  const clampedEnd = Math.min(source.rowCount, end)
  const rows: TRow[] = []
  let allLoaded = true
  for (let index = clampedStart; index < clampedEnd; index++) {
    const row = source.getRow(index)
    if (row === undefined) {
      allLoaded = false
      break
    }
    rows.push(row)
  }
  if (allLoaded) return rows
  if (!source.readRange) {
    throw new Error('Rows are not loaded and the row source cannot fetch them')
  }
  return source.readRange([clampedStart, clampedEnd], options)
}
