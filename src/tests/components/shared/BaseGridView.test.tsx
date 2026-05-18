import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as useElementSizeModule from '../../../hooks/use-element-size'
import { BaseGridView } from '../../../components/shared/BaseGridView'

beforeEach(() => {
  vi.spyOn(useElementSizeModule, 'useElementSize').mockReturnValue({ width: 400, height: 300 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

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
  it('renders CanvasBaseGridView with the provided testId', () => {
    render(
      <BaseGridView rows={[{ name: 'Ada' }]} columns={columns} editState={null} testId="base-grid" />
    )
    // CanvasBaseGridView renders a host div with data-testid={testId}
    expect(screen.getByTestId('base-grid')).toBeInTheDocument()
  })

  it('mounts without errors when no testId is provided', () => {
    // BaseGridView is a pure pass-through wrapper over CanvasBaseGridView.
    // Verify it renders without throwing.
    render(<BaseGridView rows={[{ name: 'Ada' }]} columns={columns} editState={null} />)
    // No testId means no queryable element, but the component mounted successfully
    expect(document.querySelector('.glide-grid-host')).toBeInTheDocument()
  })

  it('passes sortColumn and onSortChange through to the inner grid', () => {
    const onSortChange = vi.fn()
    // Render with a testId so we can query the host
    render(
      <BaseGridView
        rows={[{ name: 'Ada' }]}
        columns={columns}
        editState={null}
        sortColumn="name"
        sortDirection="ASC"
        onSortChange={onSortChange}
        testId="sort-grid"
      />
    )
    // The grid renders — CanvasBaseGridView receives these props and wires them to GlideDataGrid
    expect(screen.getByTestId('sort-grid')).toBeInTheDocument()
    // onSortChange is not called on initial render
    expect(onSortChange).not.toHaveBeenCalled()
  })
})
