import { useCallback, useState } from 'react'
import { buildEnvelopedPrimaryKeyPairs } from '../../lib/blob-utils'
import { fetchBlobValue } from '../../lib/table-data-commands'
import { useTableDataStore } from '../../stores/table-data-store'
import { showErrorToast } from '../../stores/toast-store'
import type { BlobEnvelope, BlobValueResponse, TableDataColumnMeta } from '../../types/schema'

const MISSING_PRIMARY_KEY_MESSAGE = 'Cannot load BLOB without a resolvable primary key'

export interface BlobViewerTarget {
  columnKey: string
  rowData: Record<string, unknown>
  primaryKeyPairs: [string, unknown][]
}

export interface BlobViewerStateOptions {
  tabId: string
  columns: TableDataColumnMeta[]
  primaryKeyColumns: string[]
}

export interface BlobViewerState {
  blobViewerTarget: BlobViewerTarget | null
  openBlobViewer: (columnKey: string, rowData: Record<string, unknown>) => void
  closeBlobViewer: () => void
  loadBlob: () => Promise<BlobValueResponse>
  applyBlob: (envelope: BlobEnvelope) => void
}

export function useBlobViewerState({
  tabId,
  columns,
  primaryKeyColumns,
}: BlobViewerStateOptions): BlobViewerState {
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const stageBlobEnvelope = useTableDataStore((state) => state.stageBlobEnvelope)
  const [blobViewerTarget, setBlobViewerTarget] = useState<BlobViewerTarget | null>(null)

  const openBlobViewer = useCallback(
    (columnKey: string, rowData: Record<string, unknown>) => {
      const converted = buildEnvelopedPrimaryKeyPairs(primaryKeyColumns, columns, rowData)
      if (!converted.ok) {
        showErrorToast('Could not open BLOB viewer', converted.error)
        return
      }
      setBlobViewerTarget({
        columnKey: columnKey,
        rowData: rowData,
        primaryKeyPairs: converted.pairs,
      })
    },
    [primaryKeyColumns, columns]
  )

  const closeBlobViewer = useCallback(() => setBlobViewerTarget(null), [])

  const loadBlob = useCallback(() => {
    if (!blobViewerTarget || !tabState) {
      throw new Error(MISSING_PRIMARY_KEY_MESSAGE)
    }
    return fetchBlobValue(
      tabState.connectionId,
      tabState.database,
      tabState.table,
      blobViewerTarget.columnKey,
      blobViewerTarget.primaryKeyPairs
    )
  }, [blobViewerTarget, tabState])

  const applyBlob = useCallback(
    (envelope: BlobEnvelope) => {
      if (!blobViewerTarget) return
      stageBlobEnvelope(tabId, blobViewerTarget.rowData, blobViewerTarget.columnKey, envelope)
    },
    [blobViewerTarget, stageBlobEnvelope, tabId]
  )

  return {
    blobViewerTarget: blobViewerTarget,
    openBlobViewer: openBlobViewer,
    closeBlobViewer: closeBlobViewer,
    loadBlob: loadBlob,
    applyBlob: applyBlob,
  }
}
