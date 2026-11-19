import type {
  BlobEnvelope,
  BlobValueResponse,
  TableDataColumnMeta,
  TableDataTabState,
} from '../../types/schema'
import {
  buildEnvelopedPrimaryKeyPairs,
  envelopeForBase64,
  isBlobPlaceholderText,
} from '../../lib/blob-utils'
import { toErrorMessage } from '../../lib/error-message'
import { isCopiedIntoClone } from '../../lib/new-row-values'
import { fetchBlobValue } from '../../lib/table-data-commands'
import { showErrorToast, showWarningToast } from '../toast-store'
import { useTableDataStore } from '../table-data-store'
import { appendDraftRow } from './cell-edit-actions'
import { cloneSourceRowKey, findRowIndexByKey, isDraftRowKey } from './row-keys'
import { buildCurrentValuesFromRow } from './row-edit-transitions'

interface TableCloneSource {
  tab: TableDataTabState
  keyColumns: string[]
  sourceValues: Record<string, unknown>
  copiedColumns: TableDataColumnMeta[]
}

interface ClonedBlob {
  value: BlobEnvelope | null
  isTooLarge: boolean
}

function isCloneBlockedByDraft(tab: TableDataTabState): boolean {
  return tab.editState?.isNewRow === true
}

function resolveCloneSource(tabId: string): TableCloneSource | null {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab?.primaryKey) return null
  if (isCloneBlockedByDraft(tab)) return null
  const sourceRowKey = cloneSourceRowKey(tab)
  if (!sourceRowKey) return null
  if (isDraftRowKey(sourceRowKey)) return null

  const rowIndex = findRowIndexByKey(tab.rows, tab.columns, sourceRowKey)
  if (rowIndex === -1) return null

  const keyColumns = tab.primaryKey.keyColumns
  return {
    tab: tab,
    keyColumns: keyColumns,
    sourceValues: buildCurrentValuesFromRow(tab.columns, tab.rows[rowIndex]),
    copiedColumns: tab.columns.filter((column) => isCopiedIntoClone(column, keyColumns)),
  }
}

function storedBlobColumnsOf(source: TableCloneSource): TableDataColumnMeta[] {
  return source.copiedColumns.filter((column) => {
    const holdsBlobPlaceholder = isBlobPlaceholderText(source.sourceValues[column.name])
    return column.isBinary && holdsBlobPlaceholder
  })
}

function clonedBlobOf(response: BlobValueResponse): ClonedBlob {
  if (response.base64 !== null) {
    return { value: envelopeForBase64(response.base64), isTooLarge: false }
  }
  return { value: null, isTooLarge: response.tooLarge }
}

async function fetchClonedBlobs(source: TableCloneSource): Promise<Map<string, ClonedBlob>> {
  const { tab } = source
  const primaryKey = buildEnvelopedPrimaryKeyPairs(
    source.keyColumns,
    tab.columns,
    source.sourceValues
  )
  if (!primaryKey.ok) throw new Error(primaryKey.error)

  const clonedBlobs = new Map<string, ClonedBlob>()
  for (const column of storedBlobColumnsOf(source)) {
    const response = await fetchBlobValue({
      connectionId: tab.connectionId,
      database: tab.database,
      table: tab.table,
      column: column.name,
      primaryKeyPairs: primaryKey.pairs,
    })
    clonedBlobs.set(column.name, clonedBlobOf(response))
  }
  return clonedBlobs
}

async function fetchClonedBlobsOrReport(
  source: TableCloneSource
): Promise<Map<string, ClonedBlob> | null> {
  try {
    return await fetchClonedBlobs(source)
  } catch (error) {
    showErrorToast('Clone failed', `Could not copy the row's BLOB values: ${toErrorMessage(error)}`)
    return null
  }
}

function tooLargeColumnNames(clonedBlobs: Map<string, ClonedBlob>): string[] {
  const columnNames: string[] = []
  for (const [columnName, clonedBlob] of clonedBlobs) {
    if (clonedBlob.isTooLarge) columnNames.push(columnName)
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

function appendClonedRow(
  tabId: string,
  source: TableCloneSource,
  clonedBlobs: Map<string, ClonedBlob>
): void {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return
  if (isCloneBlockedByDraft(tab)) return

  const uncopiedColumnNames = tooLargeColumnNames(clonedBlobs)
  const copiedColumnNames = new Set(
    source.copiedColumns
      .map((column) => column.name)
      .filter((columnName) => !uncopiedColumnNames.includes(columnName))
  )
  const clonedRow = tab.columns.map((column) => {
    if (!copiedColumnNames.has(column.name)) return null
    const clonedBlob = clonedBlobs.get(column.name)
    if (clonedBlob) return clonedBlob.value
    return source.sourceValues[column.name] ?? null
  })

  appendDraftRow(tabId, { tab: tab, rowValues: clonedRow, modifiedColumns: copiedColumnNames })
  warnAboutUncopiedBlobs(uncopiedColumnNames)
}

export async function cloneSelectedRow(tabId: string): Promise<void> {
  const source = resolveCloneSource(tabId)
  if (!source) return

  const clonedBlobs = await fetchClonedBlobsOrReport(source)
  if (!clonedBlobs) return
  appendClonedRow(tabId, source, clonedBlobs)
}

export function rowCloneActions() {
  return { cloneSelectedRow }
}
