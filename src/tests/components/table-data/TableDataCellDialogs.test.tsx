import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  BlobViewerTargetDialog,
  ForeignKeyLookupTargetDialog,
} from '../../../components/table-data/TableDataCellDialogs'
import type { BlobViewerState } from '../../../components/table-data/use-blob-viewer-state'

const TABLE_LOCATION = { connectionId: 'conn-1', database: 'shop', table: 'orders' }

function buildViewer(overrides: Partial<BlobViewerState> = {}): BlobViewerState {
  return {
    blobViewerTarget: null,
    openBlobViewer: vi.fn(),
    closeBlobViewer: vi.fn(),
    loadBlob: vi.fn(async () => ({ base64: null, byteLength: 0, tooLarge: false })),
    applyBlob: vi.fn(),
    ...overrides,
  }
}

describe('ForeignKeyLookupTargetDialog', () => {
  it('opens the lookup on the referenced table, falling back to the source database', async () => {
    render(
      <ForeignKeyLookupTargetDialog
        target={{
          columnKey: 'user_id',
          currentValue: 7,
          foreignKey: {
            columnName: 'user_id',
            referencedDatabase: '',
            referencedTable: 'users',
            referencedColumn: 'id',
            constraintName: 'fk_orders_user',
          },
          rowData: { id: 1, user_id: 7 },
        }}
        tableLocation={TABLE_LOCATION}
        isReadOnly={false}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />
    )

    expect(await screen.findByTestId('fk-lookup-title')).toHaveTextContent('users.id')
    expect(screen.getByTestId('fk-lookup-subtitle')).toHaveTextContent('orders.user_id')
  })
})

describe('BlobViewerTargetDialog', () => {
  it('renders nothing without a target', () => {
    render(<BlobViewerTargetDialog viewer={buildViewer()} />)

    expect(screen.queryByTestId('blob-viewer-dialog')).not.toBeInTheDocument()
  })

  it('opens the viewer for the target column', async () => {
    const viewer = buildViewer({
      blobViewerTarget: { columnKey: 'payload', rowData: { id: 1 }, primaryKeyPairs: [['id', 1]] },
    })

    render(<BlobViewerTargetDialog viewer={viewer} />)

    expect(await screen.findByTestId('blob-viewer-dialog')).toBeInTheDocument()
    expect(viewer.loadBlob).toHaveBeenCalled()
  })
})
