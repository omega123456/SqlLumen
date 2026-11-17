export interface RowCountInput {
  viewRowCount: number
  totalRows: number
  isFiltered: boolean
  truncated: boolean
  autoLimitApplied: boolean
  appliedRowLimit: number | null
}

export interface RowCountParts {
  count: string
  segment: string | null
  segmentKind: 'truncated' | 'autoLimit' | null
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

const SINGULAR_ROWS_WORD = 'row'
const PLURAL_ROWS_WORD = 'rows'

function rowsWord(count: number): string {
  return count === 1 ? SINGULAR_ROWS_WORD : PLURAL_ROWS_WORD
}

export function formatRowsCount(count: number): string {
  return `${formatCount(count)} ${rowsWord(count)}`
}

function totalRowsWord(input: RowCountInput): string {
  return input.truncated ? PLURAL_ROWS_WORD : rowsWord(input.totalRows)
}

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

export function formatRowRange(from: number, to: number): string {
  return `${formatCount(from)}–${formatCount(to)}`
}
