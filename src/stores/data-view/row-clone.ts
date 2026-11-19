import type {
  BlobEnvelope,
  BlobValueResponse,
  QueryTableEditInfo,
  TableDataColumnMeta,
} from '../../types/schema'
import { envelopeForBase64, isBlobPlaceholderText } from '../../lib/blob-utils'
import { isCopiedIntoClone } from '../../lib/new-row-values'
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
import { storedBlobLoadOf } from './stored-blobs'

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
  ref: DataViewSurfaceRef
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
    ref: ref,
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

function clonedBlobOf(response: BlobValueResponse): ClonedBlob {
  if (response.base64 !== null) {
    return { value: envelopeForBase64(response.base64), isTooLarge: false }
  }
  return { value: null, isTooLarge: response.tooLarge }
}

const MISSING_KEY_MESSAGE = 'The row has no primary key to read its BLOB values by.'

async function fetchStoredBlob(source: CloneSource, cell: StoredBlobCell): Promise<ClonedBlob> {
  const stored = storedBlobLoadOf(source.ref, {
    columnIndex: cell.columnIndex,
    valueAt: (columnIndex) => source.sourceRow[columnIndex],
  })
  if (!stored) throw new Error(MISSING_KEY_MESSAGE)
  if (!stored.ok) throw new Error(stored.error)
  return clonedBlobOf(await stored.load())
}

async function fetchStoredBlobs(
  source: CloneSource,
  cells: StoredBlobCell[]
): Promise<Map<number, ClonedBlob>> {
  const clonedBlobs = new Map<number, ClonedBlob>()
  for (const cell of cells) {
    clonedBlobs.set(cell.columnIndex, await fetchStoredBlob(source, cell))
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
