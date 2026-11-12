/**
 * The single formatter for the query-result row-count string shown by the
 * result toolbar and the StatusBar (wireframe 3):
 *
 * | State                  | String                                  |
 * |------------------------|-----------------------------------------|
 * | Plain                  | `12,340 rows`                           |
 * | Filtered               | `2,340 of 12,340 rows`                  |
 * | Truncated              | `100,000+ rows · truncated`             |
 * | Filtered and truncated | `2,340 of 100,000+ rows · truncated`    |
 * | Auto-limit applied     | `1,000 rows · 1,000-row limit applied`  |
 *
 * Numbers use the user's locale separators. The truncated segment replaces the
 * auto-limit segment; only one of them is ever shown.
 */

export interface RowCountInput {
  /** Rows in the current view (after filter and deletes). */
  viewRowCount: number
  /** Live base rows in the cached result (deleted rows excluded). */
  totalRows: number
  /** True when filter conditions are active on the result. */
  isFiltered: boolean
  /** True when the result hit the row ceiling. */
  truncated: boolean
  /** True when an auto-LIMIT was injected. */
  autoLimitApplied: boolean
  /** LIMIT actually injected (after clamping), or null. */
  appliedRowLimit: number | null
}

/** The row-count string split into its count and its optional trailing segment. */
export interface RowCountParts {
  /** e.g. `12,340 rows`, `2,340 of 12,340 rows`, `100,000+ rows`. */
  count: string
  /** `truncated`, `1,000-row limit applied`, or null. */
  segment: string | null
  /** Which kind of segment `segment` is. */
  segmentKind: 'truncated' | 'autoLimit' | null
}

/** Locale-formatted integer (thousands separators from the user's locale). */
export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

const SINGULAR_ROWS_WORD = 'row'
const PLURAL_ROWS_WORD = 'rows'

function rowsWord(count: number): string {
  return count === 1 ? SINGULAR_ROWS_WORD : PLURAL_ROWS_WORD
}

function totalRowsWord(input: RowCountInput): string {
  return input.truncated ? PLURAL_ROWS_WORD : rowsWord(input.totalRows)
}

/** Split the row-count string into its count and trailing segment. */
export function formatRowCountParts(input: RowCountInput): RowCountParts {
  const total = `${formatCount(input.totalRows)}${input.truncated ? '+' : ''}`
  const count = input.isFiltered
    ? `${formatCount(input.viewRowCount)} of ${total} ${rowsWord(input.totalRows)}`
    : `${total} ${totalRowsWord(input)}`

  if (input.truncated) {
    return { count: count, segment: 'truncated', segmentKind: 'truncated' }
  }
  const appliedRowLimit = input.autoLimitApplied ? input.appliedRowLimit : null
  if (appliedRowLimit != null) {
    return {
      count: count,
      segment: `${formatCount(appliedRowLimit)}-row limit applied`,
      segmentKind: 'autoLimit',
    }
  }
  return { count: count, segment: null, segmentKind: null }
}

/** "1,001–2,000"-style view-position range label (1-based, inclusive). */
export function formatRowRange(from: number, to: number): string {
  return `${formatCount(from)}–${formatCount(to)}`
}
