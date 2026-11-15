import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BlobViewerTargetDialog } from '../../../../components/shared/data-view/BlobViewerTargetDialog'
import { ForeignKeyLookupTargetDialog } from '../../../../components/shared/data-view/ForeignKeyLookupTargetDialog'
import type { BlobViewer } from '../../../../components/shared/data-view/use-blob-viewer'
import type { ForeignKeyLookup } from '../../../../components/shared/data-view/use-foreign-key-lookup'
import { makeForeignKeyColumn } from '../../../helpers/column-meta-fixtures'

const TABLE_LOCATION = { connectionId: 'conn-1', database: 'shop', table: 'orders' }
const CELL = { identity: 1, rowIndex: 0, rowData: { id: 1, user_id: 7 }, columnKey: 'user_id' }

function buildLookup(overrides: Partial<ForeignKeyLookup<number>> = {}): ForeignKeyLookup<number> {
  return {
    target: null,
    isReadOnly: false,
    openLookup: vi.fn(async () => {}),
    onFkCellAction: vi.fn(async () => {}),
    applyLookup: vi.fn(),
    closeLookup: vi.fn(),
    ...overrides,
  }
}

function buildViewer(overrides: Partial<BlobViewer<number>> = {}): BlobViewer<number> {
  return {
    target: null,
    openBlobViewer: vi.fn(),
    openFormFieldBlob: vi.fn(),
    closeBlobViewer: vi.fn(),
    applyBlob: vi.fn(),
    ...overrides,
  }
}

describe('ForeignKeyLookupTargetDialog', () => {
  it('opens the lookup on the referenced table, falling back to the source database', async () => {
    const lookup = buildLookup({
      target: {
        ...CELL,
        sourceColumn: 'user_id',
        currentValue: 7,
        foreignKey: makeForeignKeyColumn({
          columnName: 'user_id',
          referencedDatabase: '',
          referencedTable: 'users',
          referencedColumn: 'id',
        }),
      },
    })

    render(<ForeignKeyLookupTargetDialog lookup={lookup} location={TABLE_LOCATION} />)

    expect(await screen.findByTestId('fk-lookup-title')).toHaveTextContent('users.id')
    expect(screen.getByTestId('fk-lookup-subtitle')).toHaveTextContent('orders.user_id')
  })

  it('renders nothing without a target or a location', () => {
    const { rerender } = render(
      <ForeignKeyLookupTargetDialog lookup={buildLookup()} location={TABLE_LOCATION} />
    )
    expect(screen.queryByTestId('fk-lookup-title')).not.toBeInTheDocument()

    const lookup = buildLookup({
      target: {
        ...CELL,
        sourceColumn: 'user_id',
        currentValue: 7,
        foreignKey: makeForeignKeyColumn(),
      },
    })
    rerender(<ForeignKeyLookupTargetDialog lookup={lookup} location={null} />)
    expect(screen.queryByTestId('fk-lookup-title')).not.toBeInTheDocument()
  })
})

describe('BlobViewerTargetDialog', () => {
  it('renders nothing without a target', () => {
    render(<BlobViewerTargetDialog viewer={buildViewer()} />)

    expect(screen.queryByTestId('blob-viewer-dialog')).not.toBeInTheDocument()
  })

  it('loads the blob through the target loader in edit mode', async () => {
    const loader = vi.fn(async () => ({ base64: null, byteLength: 0, tooLarge: false }))
    const viewer = buildViewer({
      target: { cell: CELL, columnLabel: 'payload', isEditable: true, content: { loader } },
    })

    render(<BlobViewerTargetDialog viewer={viewer} />)

    expect(await screen.findByTestId('blob-viewer-dialog')).toBeInTheDocument()
    expect(loader).toHaveBeenCalled()
  })
})
