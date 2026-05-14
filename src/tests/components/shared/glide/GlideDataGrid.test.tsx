import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import { GridCellKind, type GridCell } from '@glideapps/glide-data-grid'
import { GlideDataGrid } from '../../../../components/shared/glide/GlideDataGrid'
import type { GridHandle } from '../../../../components/shared/glide/glide-grid-types'

const mockDataEditor = vi.fn()
let mockSize = { width: 400, height: 300 }

vi.mock('../../../../hooks/use-element-size', () => ({
  useElementSize: () => mockSize,
}))

vi.mock('@glideapps/glide-data-grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@glideapps/glide-data-grid')>()
  const React = await import('react')
  return {
    ...actual,
    DataEditor: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockDataEditor(props)
      React.useImperativeHandle(ref, () => ({
        scrollTo: mockScrollTo,
        focus: mockFocus,
        getBounds: mockGetBounds,
      }))
      return React.createElement('div', { 'data-testid': 'mock-data-editor' }, 'editor')
    }),
  }
})

const mockScrollTo = vi.fn()
const mockFocus = vi.fn()
const mockGetBounds = vi.fn(() => ({ x: 1, y: 2, width: 3, height: 4 }))
const mockMutationObserverObserve = vi.fn()
const mockMutationObserverDisconnect = vi.fn()

class MockMutationObserver {
  constructor(private readonly callback: MutationCallback) {}

  observe = mockMutationObserverObserve
  disconnect = mockMutationObserverDisconnect
  takeRecords() {
    return []
  }

  flush() {
    this.callback([], this as unknown as MutationObserver)
  }
}

beforeEach(() => {
  mockDataEditor.mockClear()
  mockScrollTo.mockClear()
  mockFocus.mockClear()
  mockGetBounds.mockClear()
  mockMutationObserverObserve.mockClear()
  mockMutationObserverDisconnect.mockClear()
  mockSize = { width: 400, height: 300 }
  vi.stubGlobal('MutationObserver', MockMutationObserver)
})

describe('GlideDataGrid', () => {
  it('passes core grid data through to DataEditor', () => {
    const getCellContent = vi.fn(
      (): GridCell => ({
        kind: GridCellKind.Text,
        data: 'x',
        displayData: 'x',
        allowOverlay: false,
        readonly: true,
      })
    )
    render(
      <div style={{ width: 400, height: 300 }}>
        <GlideDataGrid
          columns={[{ title: 'Id', width: 80 }]}
          rows={[{ id: 1 }, { id: 2 }]}
          getCellContent={getCellContent}
          data-testid="glide-host"
        />
      </div>
    )
    expect(screen.getByTestId('glide-host')).toBeInTheDocument()
    const props = mockDataEditor.mock.lastCall?.[0] as Record<string, unknown>
    expect(props.columns).toEqual([{ title: 'Id', width: 80 }])
    expect(props.rows).toBe(2)
    expect(props.getCellContent).toBe(getCellContent)
    expect(props.cellActivationBehavior).toBe('double-click')
  })

  it('renders a placeholder when host size is zero', () => {
    mockSize = { width: 0, height: 0 }
    render(
      <GlideDataGrid columns={[]} rows={[]} getCellContent={vi.fn()} data-testid="zero-grid" />
    )
    expect(screen.getByTestId('zero-grid-placeholder')).toBeInTheDocument()
  })

  it('emits column and row marker widths on the grid container', () => {
    render(
      <GlideDataGrid
        columns={[
          { title: 'Id', width: 80 },
          { title: 'Name', width: 160 },
          { title: 'Active', width: 96 },
        ]}
        rows={[]}
        getCellContent={vi.fn()}
        rowMarkers="checkbox"
        data-testid="attribute-grid"
      />
    )

    const host = screen.getByTestId('attribute-grid')
    expect(host).toHaveAttribute('data-glide-column-width', '[80,160,96]')
    expect(host).toHaveAttribute('data-row-marker-width', '32')
  })

  it('wires interaction callbacks', () => {
    const onColumnResize = vi.fn()
    const onHeaderClicked = vi.fn()
    const onCellClicked = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <div style={{ width: 400, height: 300 }}>
        <GlideDataGrid
          columns={[{ title: 'Id', width: 80 }]}
          rows={[{ id: 1 }]}
          getCellContent={vi.fn()}
          onColumnResize={onColumnResize}
          onHeaderClicked={onHeaderClicked}
          onCellClicked={onCellClicked}
          onKeyDown={onKeyDown}
        />
      </div>
    )
    const props = mockDataEditor.mock.lastCall?.[0] as {
      onColumnResize: (column: unknown, width: number, index: number) => void
      onHeaderClicked: (index: number) => void
      onCellClicked: (cell: readonly [number, number], event: unknown) => void
      onKeyDown: (event: { key: string }) => void
    }
    props.onColumnResize({}, 120, 0)
    props.onHeaderClicked(0)
    props.onCellClicked([0, 0], {})
    props.onKeyDown({ key: 'ArrowDown' })
    expect(onColumnResize).toHaveBeenCalledWith(0, 120)
    expect(onHeaderClicked).toHaveBeenCalledWith(0)
    expect(onCellClicked).toHaveBeenCalledWith([0, 0], {})
    expect(onKeyDown).toHaveBeenCalledWith({ key: 'ArrowDown' })
  })

  it('exposes cell scrolling, focus, and element through the grid handle', () => {
    const ref = createRef<{
      scrollToCell: (pos: { idx?: number; rowIdx?: number }) => void
      selectCell: (pos: { idx: number; rowIdx: number }) => void
      element: HTMLDivElement | null
    }>()
    render(
      <GlideDataGrid
        ref={ref}
        columns={[{ title: 'Id', width: 80 }]}
        rows={[{ id: 1 }]}
        getCellContent={vi.fn()}
        data-testid="handle-grid"
      />
    )

    ref.current?.scrollToCell({ rowIdx: 4 })
    expect(mockScrollTo).toHaveBeenCalledWith(0, 4, 'both')

    ref.current?.selectCell({ idx: 2, rowIdx: 3 })
    expect(mockScrollTo).toHaveBeenCalledWith(2, 3, 'both')
    expect(mockFocus).toHaveBeenCalled()
    expect(ref.current?.element).toBe(screen.getByTestId('handle-grid'))
  })

  it('selects cells through controlled grid selection and can request editor opening', () => {
    vi.useFakeTimers()
    const dispatchSpy = vi.spyOn(HTMLCanvasElement.prototype, 'dispatchEvent')
    const ref = createRef<GridHandle>()
    const onSelectionChange = vi.fn()
    render(
      <GlideDataGrid
        ref={ref}
        columns={[{ title: 'Id', width: 80 }]}
        rows={[{ id: 1 }]}
        getCellContent={vi.fn()}
        onSelectionChange={onSelectionChange}
      />
    )
    const canvas = document.createElement('canvas')
    canvas.setAttribute('data-testid', 'data-grid-canvas')
    screen.getByTestId('mock-data-editor').appendChild(canvas)

    act(() => {
      ref.current?.selectCell({ idx: 0, rowIdx: 0 }, { enableEditor: true, shouldFocusCell: true })
      vi.runAllTimers()
    })

    expect(onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({ current: expect.objectContaining({ cell: [0, 0] }) })
    )
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }))
    dispatchSpy.mockRestore()
    vi.useRealTimers()
  })

  it('passes custom editor callbacks through without Glide overlay chrome', () => {
    const provideEditor = vi.fn()

    render(
      <GlideDataGrid
        columns={[{ title: 'Id', width: 80 }]}
        rows={[{ id: 1 }]}
        getCellContent={vi.fn()}
        provideEditor={provideEditor}
      />
    )

    const props = mockDataEditor.mock.lastCall?.[0] as {
      provideEditor: typeof provideEditor
    }

    expect(props.provideEditor).toBe(provideEditor)
  })

  it('constrains Glide overlay width from the requested editor width', async () => {
    vi.useFakeTimers()
    const portal = document.createElement('div')
    portal.id = 'portal'
    const overlay = document.createElement('div')
    overlay.className = 'gdg-d19meir1'
    const editorRoot = document.createElement('div')
    editorRoot.setAttribute('data-sqllumen-glide-editor-root', 'true')
    editorRoot.setAttribute('data-sqllumen-editor-width', '58')
    overlay.appendChild(editorRoot)
    portal.appendChild(overlay)
    document.body.appendChild(portal)

    render(
      <GlideDataGrid
        columns={[{ title: 'Id', width: 80 }]}
        rows={[{ id: 1 }]}
        getCellContent={vi.fn()}
      />
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(overlay.style.width).toBe('58px')
    expect(overlay.style.maxWidth).toBe('58px')
    expect(overlay.style.getPropertyValue('--d19meir1-2')).toBe('58px')
    expect(overlay.style.overflow).toBe('hidden')

    portal.remove()
    vi.useRealTimers()
  })

  it('maps cell activation only to onCellActivated', () => {
    const onCellDoubleClicked = vi.fn()
    const onCellActivated = vi.fn()
    render(
      <GlideDataGrid
        columns={[{ title: 'Id', width: 80 }]}
        rows={[{ id: 1 }]}
        getCellContent={vi.fn()}
        onCellDoubleClicked={onCellDoubleClicked}
        onCellActivated={onCellActivated}
      />
    )
    const props = mockDataEditor.mock.lastCall?.[0] as {
      onCellActivated: (cell: readonly [number, number]) => void
    }
    props.onCellActivated([2, 3])
    expect(onCellActivated).toHaveBeenCalledWith([2, 3])
    expect(mockGetBounds).not.toHaveBeenCalled()
    expect(onCellDoubleClicked).not.toHaveBeenCalled()
  })

  it('forwards double-click click events to onCellDoubleClicked without affecting activation', () => {
    const onCellClicked = vi.fn()
    const onCellDoubleClicked = vi.fn()
    const onCellActivated = vi.fn()
    render(
      <GlideDataGrid
        columns={[{ title: 'Id', width: 80 }]}
        rows={[{ id: 1 }]}
        getCellContent={vi.fn()}
        onCellClicked={onCellClicked}
        onCellDoubleClicked={onCellDoubleClicked}
        onCellActivated={onCellActivated}
      />
    )

    const props = mockDataEditor.mock.lastCall?.[0] as {
      onCellClicked: (
        cell: readonly [number, number],
        event: { isDoubleClick?: boolean; preventDefault?: () => void }
      ) => void
    }

    const event = { isDoubleClick: true, preventDefault: vi.fn() }
    props.onCellClicked([2, 3], event)

    expect(onCellClicked).toHaveBeenCalledWith([2, 3], event)
    expect(onCellDoubleClicked).toHaveBeenCalledWith([2, 3], event)
    expect(onCellActivated).not.toHaveBeenCalled()
  })

  it('uses the exact requested overlay width for wider editors', async () => {
    vi.useFakeTimers()
    const portal = document.createElement('div')
    portal.id = 'portal'
    const overlay = document.createElement('div')
    overlay.className = 'gdg-d19meir1'
    const editorRoot = document.createElement('div')
    editorRoot.setAttribute('data-sqllumen-glide-editor-root', 'true')
    editorRoot.setAttribute('data-sqllumen-editor-width', '200')
    overlay.appendChild(editorRoot)
    portal.appendChild(overlay)
    document.body.appendChild(portal)

    render(<GlideDataGrid columns={[{ title: 'Id', width: 80 }]} rows={[{ id: 1 }]} getCellContent={vi.fn()} />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(overlay.style.width).toBe('200px')
    expect(overlay.style.maxWidth).toBe('200px')
    expect(overlay.style.getPropertyValue('--d19meir1-2')).toBe('200px')

    portal.remove()
    vi.useRealTimers()
  })

  it('supports zero-extra-width editors by honoring their exact requested width', async () => {
    vi.useFakeTimers()
    const portal = document.createElement('div')
    portal.id = 'portal'
    const overlay = document.createElement('div')
    overlay.className = 'gdg-d19meir1'
    const editorRoot = document.createElement('div')
    editorRoot.setAttribute('data-sqllumen-glide-editor-root', 'true')
    editorRoot.setAttribute('data-sqllumen-editor-width', '180')
    overlay.appendChild(editorRoot)
    portal.appendChild(overlay)
    document.body.appendChild(portal)

    render(<GlideDataGrid columns={[{ title: 'Id', width: 80 }]} rows={[{ id: 1 }]} getCellContent={vi.fn()} />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(overlay.style.width).toBe('180px')
    expect(overlay.style.maxWidth).toBe('180px')
    expect(overlay.style.getPropertyValue('--d19meir1-2')).toBe('180px')

    portal.remove()
    vi.useRealTimers()
  })
})
