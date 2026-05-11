import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BaseGridView } from '../../../components/shared/BaseGridView'

const mockCanvasBaseGridView = vi.hoisted(() => vi.fn((props: Record<string, unknown>) => (
  <div data-testid="mock-canvas-grid" data-row-count={(props.rows as unknown[])?.length ?? 0} />
)))

vi.mock('../../../components/shared/glide/CanvasBaseGridView', () => ({
  CanvasBaseGridView: mockCanvasBaseGridView,
}))

const columns = [
  {
    key: 'name',
    displayName: 'Name',
    dataType: 'VARCHAR',
    editable: true,
    isBinary: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
]

describe('BaseGridView', () => {
  it('renders CanvasBaseGridView', () => {
    render(<BaseGridView rows={[{ name: 'Ada' }]} columns={columns} editState={null} />)
    expect(screen.getByTestId('mock-canvas-grid')).toBeInTheDocument()
  })

  it('passes props through to the inner grid', () => {
    const onSortChange = vi.fn()
    render(
      <BaseGridView
        rows={[{ name: 'Ada' }]}
        columns={columns}
        editState={null}
        sortColumn="name"
        sortDirection="ASC"
        onSortChange={onSortChange}
      />
    )
    expect(mockCanvasBaseGridView).toHaveBeenLastCalledWith(
      expect.objectContaining({ rows: [{ name: 'Ada' }], columns, sortColumn: 'name', onSortChange }),
      undefined
    )
  })
})
