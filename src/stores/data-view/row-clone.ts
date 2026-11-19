import type {
  BlobEnvelope,
  BlobValueResponse,
  QueryTableEditInfo,
  TableDataColumnMeta,
} from '../../types/schema'
import {
  buildEnvelopedPrimaryKeyPairs,
  envelopeForBase64,
  isBlobPlaceholderText,
} from '../../lib/blob-utils'
import { isCopiedIntoClone } from '../../lib/new-row-values'
import { fetchBlobValue } from '../../lib/table-data-commands'
import { toErrorMessage } from '../../lib/error-message'
import { countRanges, firstRangeStart } from '../../lib/view-ranges'
import type { CellProjection } from '../../lib/row-write-payloads'
import { showErrorToast, showWarningToast } from '../toast-store'
import type { DataViewState, DataViewSurfaceRef } from './data-view-types'
import {
  editTableOf,
  hasUnsavedModifications,
  isSelectedRowInView,
  rowAt,
} from './data-view-selectors'
import { boundTableColumnAt, isBoundColumn, openDraftRow, type DraftRow } from './edit-actions'
import { readView, routeOf } from './route-registry'

export function cloneSourceRowIndex(view: DataViewState): number | null {
  const checkedCount = countRanges(view.checked.ranges)
  if (checkedCount === 1) return firstRangeStart(view.checked.ranges)
  if (checkedCount > 1) return null
  if (!isSelectedRowInView(view)) return null
  return view.selection.rowIndex
}

export function copiedBoundColumnNames(
  view: DataViewState,
  table: Pick<QueryTableEditInfo, 'columns' | 'primaryKey'>
): Set<string> {
  const keyColumns = table.primaryKey?.keyColumns ?? []
  const copiedColumnNames = new Set<string>()
  for (const tableColumn of table.columns) {
    const isCopiedBoundColumn =
      isBoundColumn(view, tableColumn) && isCopiedIntoClone(tableColumn, keyColumns)
    if (isCopiedBoundColumn) copiedColumnNames.add(tableColumn.name)
  }
  return copiedColumnNames
}

interface CloneSource {
  view: DataViewState
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
  sourceRow: unknown[]
}

function isCloneBlockedByDraft(view: DataViewState): boolean {
  if (view.edit.draftRow) return true
  return view.edit.state?.isNewRow === true
}

function resolveCloneSourceRowIndex(view: DataViewState): number | null {
  if (!view.editTarget.tableName) return null
  if (hasUnsavedModifications(view)) {
    showErrorToast('Unsaved changes', 'Save or discard the current row before cloning another row.')
    return null
  }
  if (isCloneBlockedByDraft(view)) return null
  return cloneSourceRowIndex(view)
}

function resolveCloneSource(ref: DataViewSurfaceRef, view: DataViewState): CloneSource | null {
  const sourceRowIndex = resolveCloneSourceRowIndex(view)
  if (sourceRowIndex === null) return null

  const tableInfo = editTableOf(view)
  if (!tableInfo?.primaryKey) return null
  if (tableInfo.primaryKey.isUniqueKeyFallback) {
    showErrorToast(
      'Clone failed',
      'Cannot clone query-result rows when edit mode is using a unique-key fallback.'
    )
    return null
  }

  const sourceRow = rowAt(ref, view, sourceRowIndex)?.row
  if (!sourceRow) return null
  return {
    view: view,
    tableInfo: tableInfo,
    keyColumns: tableInfo.primaryKey.keyColumns,
    sourceRow: sourceRow,
  }
}

interface ClonedBlob {
  value: BlobEnvelope | null
  isTooLarge: boolean
}

interface StoredBlobCell {
  columnIndex: number
  tableColumn: TableDataColumnMeta
}

function storedBlobCellsOf(source: CloneSource, copiedColumnNames: Set<string>): StoredBlobCell[] {
  const cells: StoredBlobCell[] = []
  source.view.slot.columns.forEach((_column, columnIndex) => {
    const tableColumn = boundTableColumnAt(source.view, source.tableInfo, columnIndex)
    if (!tableColumn?.isBinary) return
    if (!copiedColumnNames.has(tableColumn.name)) return
    if (!isBlobPlaceholderText(source.sourceRow[columnIndex])) return
    cells.push({ columnIndex: columnIndex, tableColumn: tableColumn })
  })
  return cells
}

function sourceKeyValues(source: CloneSource): Record<string, unknown> {
  const keyValues: Record<string, unknown> = {}
  for (const keyColumn of source.keyColumns) {
    const columnIndex = source.view.editTarget.boundIndexByName.get(keyColumn.toLowerCase())
    keyValues[keyColumn] = columnIndex === undefined ? undefined : source.sourceRow[columnIndex]
  }
  return keyValues
}

function clonedBlobOf(response: BlobValueResponse): ClonedBlob {
  if (response.base64 !== null) {
    return { value: envelopeForBase64(response.base64), isTooLarge: false }
  }
  return { value: null, isTooLarge: response.tooLarge }
}

async function fetchStoredBlobs(
  source: CloneSource,
  cells: StoredBlobCell[]
): Promise<Map<number, ClonedBlob>> {
  const primaryKey = buildEnvelopedPrimaryKeyPairs(
    source.keyColumns,
    source.tableInfo.columns,
    sourceKeyValues(source)
  )
  if (!primaryKey.ok) throw new Error(primaryKey.error)

  const clonedBlobs = new Map<number, ClonedBlob>()
  for (const cell of cells) {
    const response = await fetchBlobValue({
      connectionId: source.view.slot.connectionId,
      database: source.tableInfo.database,
      table: source.tableInfo.table,
      column: cell.tableColumn.name,
      primaryKeyPairs: primaryKey.pairs,
    })
    clonedBlobs.set(cell.columnIndex, clonedBlobOf(response))
  }
  return clonedBlobs
}

async function fetchStoredBlobsOrReport(
  source: CloneSource,
  cells: StoredBlobCell[]
): Promise<Map<number, ClonedBlob> | null> {
  try {
    return await fetchStoredBlobs(source, cells)
  } catch (error) {
    showErrorToast('Clone failed', `Could not copy the row's BLOB values: ${toErrorMessage(error)}`)
    return null
  }
}

type InlineBinaryCellClone = (sourceValue: unknown) => unknown

const INLINE_BINARY_CELL_CLONE: Record<CellProjection, InlineBinaryCellClone> = {
  full: (sourceValue) =>
    typeof sourceValue === 'string' ? envelopeForBase64(sourceValue) : sourceValue,
  blobPlaceholders: (sourceValue) => sourceValue,
}

interface ClonedRowInputs {
  source: CloneSource
  copiedColumnNames: Set<string>
  clonedBlobs: Map<number, ClonedBlob>
  projection: CellProjection
}

function clonedCellValue(inputs: ClonedRowInputs, columnIndex: number): unknown {
  const { source, copiedColumnNames, clonedBlobs } = inputs
  const sourceValue = source.sourceRow[columnIndex] ?? null
  const tableColumn = boundTableColumnAt(source.view, source.tableInfo, columnIndex)
  if (!tableColumn) return sourceValue
  if (!copiedColumnNames.has(tableColumn.name)) return null
  const clonedBlob = clonedBlobs.get(columnIndex)
  if (clonedBlob) return clonedBlob.value
  if (!tableColumn.isBinary) return sourceValue
  return INLINE_BINARY_CELL_CLONE[inputs.projection](sourceValue)
}

function tooLargeColumnNames(source: CloneSource, clonedBlobs: Map<number, ClonedBlob>): string[] {
  const columnNames: string[] = []
  for (const [columnIndex, clonedBlob] of clonedBlobs) {
    if (!clonedBlob.isTooLarge) continue
    const tableColumn = boundTableColumnAt(source.view, source.tableInfo, columnIndex)
    if (tableColumn) columnNames.push(tableColumn.name)
  }
  return columnNames
}

function warnAboutUncopiedBlobs(columnNames: string[]): void {
  if (columnNames.length === 0) return
  showWarningToast(
    'Some BLOB values were not copied',
    `These BLOB columns are over 10 MB and were left empty in the new row: ${columnNames.join(', ')}.`
  )
}

function buildClonedDraftRow(inputs: ClonedRowInputs): DraftRow {
  const row = inputs.source.view.slot.columns.map((_column, columnIndex) =>
    clonedCellValue(inputs, columnIndex)
  )
  return {
    row: row,
    modifiedColumns: inputs.copiedColumnNames,
    insertEligibleColumns: new Set(inputs.copiedColumnNames),
  }
}

function copiedColumnsWithout(copiedColumnNames: Set<string>, excluded: string[]): Set<string> {
  const remaining = new Set(copiedColumnNames)
  for (const columnName of excluded) remaining.delete(columnName)
  return remaining
}

function openClonedDraft(
  ref: DataViewSurfaceRef,
  source: CloneSource,
  clonedBlobs: Map<number, ClonedBlob>
) {
  const latestView = readView(ref)
  if (!latestView) return
  if (isCloneBlockedByDraft(latestView)) return

  const uncopiedColumnNames = tooLargeColumnNames(source, clonedBlobs)
  const copiedColumnNames = copiedColumnsWithout(
    copiedBoundColumnNames(source.view, source.tableInfo),
    uncopiedColumnNames
  )
  const draft = buildClonedDraftRow({
    source: source,
    copiedColumnNames: copiedColumnNames,
    clonedBlobs: clonedBlobs,
    projection: routeOf(ref).writes.cellProjection,
  })
  const hasCopiedColumns = draft.insertEligibleColumns.size > 0
  if (!hasCopiedColumns) return

  openDraftRow(ref, { view: latestView, draft: draft, keyColumns: source.keyColumns })
  warnAboutUncopiedBlobs(uncopiedColumnNames)
}

export async function cloneSelectedRow(ref: DataViewSurfaceRef): Promise<void> {
  const view = readView(ref)
  if (!view) return

  const source = resolveCloneSource(ref, view)
  if (!source) return

  const copiedColumnNames = copiedBoundColumnNames(view, source.tableInfo)
  const storedBlobCells = storedBlobCellsOf(source, copiedColumnNames)
  if (storedBlobCells.length === 0) {
    openClonedDraft(ref, source, new Map())
    return
  }
  const clonedBlobs = await fetchStoredBlobsOrReport(source, storedBlobCells)
  if (!clonedBlobs) return
  openClonedDraft(ref, source, clonedBlobs)
}
