import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  isDragHandleBlocked,
  usePointerTabDrag,
} from '../../../components/shared/use-pointer-tab-drag'

const TAB_IDS = ['first', 'second', 'third']
const TAB_TEST_ID_PREFIX = 'drag-tab-'
const TAB_TOP = 0
const TAB_BOTTOM = 30
const TAB_WIDTH = 100

interface DragHarnessProps {
  onReorder: (tabId: string, insertIndex: number) => void
  onSelect: (tabId: string) => void
}

function DragHarness({ onReorder, onSelect }: DragHarnessProps) {
  const { draggingTabId, dropIndicatorFor, startPointerDrag, isSelectSuppressed } =
    usePointerTabDrag({
      tabIds: TAB_IDS,
      tabTestIdPrefix: TAB_TEST_ID_PREFIX,
      onReorder: onReorder,
    })
  return (
    <div>
      <span data-testid="dragging-tab">{draggingTabId ?? 'none'}</span>
      {TAB_IDS.map((tabId) => (
        <div
          key={tabId}
          data-testid={`${TAB_TEST_ID_PREFIX}${tabId}`}
          data-drop-indicator={dropIndicatorFor(tabId) ?? 'none'}
          onPointerDown={(event) => startPointerDrag(tabId, event)}
          onClick={() => {
            if (isSelectSuppressed()) return
            onSelect(tabId)
          }}
        >
          {tabId}
          <button type="button">close {tabId}</button>
        </div>
      ))}
    </div>
  )
}

function mockTabRects(): void {
  TAB_IDS.forEach((tabId, index) => {
    const left = index * TAB_WIDTH
    vi.spyOn(
      screen.getByTestId(`${TAB_TEST_ID_PREFIX}${tabId}`),
      'getBoundingClientRect'
    ).mockReturnValue({
      left: left,
      right: left + TAB_WIDTH,
      top: TAB_TOP,
      bottom: TAB_BOTTOM,
      width: TAB_WIDTH,
      height: TAB_BOTTOM,
      x: left,
      y: TAB_TOP,
      toJSON: () => ({}),
    } as DOMRect)
  })
}

function renderHarness() {
  const onReorder = vi.fn()
  const onSelect = vi.fn()
  render(<DragHarness onReorder={onReorder} onSelect={onSelect} />)
  mockTabRects()
  return { onReorder: onReorder, onSelect: onSelect }
}

describe('isDragHandleBlocked', () => {
  it('blocks drags that start on interactive controls', () => {
    const button = document.createElement('button')
    expect(isDragHandleBlocked(button)).toBe(true)
  })

  it('allows drags from plain elements and non-element targets', () => {
    expect(isDragHandleBlocked(document.createElement('div'))).toBe(false)
    expect(isDragHandleBlocked(null)).toBe(false)
  })
})

describe('usePointerTabDrag', () => {
  it('reorders a tab dropped before another tab', () => {
    const { onReorder } = renderHarness()

    fireEvent.pointerDown(screen.getByTestId('drag-tab-third'), {
      button: 0,
      clientX: 250,
      clientY: 15,
    })
    fireEvent.pointerMove(window, { clientX: 20, clientY: 15 })

    expect(screen.getByTestId('dragging-tab')).toHaveTextContent('third')
    expect(screen.getByTestId('drag-tab-first')).toHaveAttribute('data-drop-indicator', 'before')

    fireEvent.pointerUp(window, { clientX: 20, clientY: 15 })

    expect(onReorder).toHaveBeenCalledWith('third', 0)
    expect(screen.getByTestId('dragging-tab')).toHaveTextContent('none')
  })

  it('ignores pointer movement below the drag threshold', () => {
    const { onReorder } = renderHarness()

    fireEvent.pointerDown(screen.getByTestId('drag-tab-first'), {
      button: 0,
      clientX: 20,
      clientY: 15,
    })
    fireEvent.pointerMove(window, { clientX: 22, clientY: 15 })
    fireEvent.pointerUp(window, { clientX: 22, clientY: 15 })

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('clears the drop target when the pointer leaves every tab', () => {
    const { onReorder } = renderHarness()

    fireEvent.pointerDown(screen.getByTestId('drag-tab-first'), {
      button: 0,
      clientX: 20,
      clientY: 15,
    })
    fireEvent.pointerMove(window, { clientX: 250, clientY: 15 })
    expect(screen.getByTestId('drag-tab-third')).toHaveAttribute('data-drop-indicator', 'after')

    fireEvent.pointerMove(window, { clientX: 250, clientY: 200 })
    expect(screen.getByTestId('drag-tab-third')).toHaveAttribute('data-drop-indicator', 'none')

    fireEvent.pointerUp(window, { clientX: 250, clientY: 200 })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('does not commit a cancelled drag', () => {
    const { onReorder } = renderHarness()

    fireEvent.pointerDown(screen.getByTestId('drag-tab-third'), {
      button: 0,
      clientX: 250,
      clientY: 15,
    })
    fireEvent.pointerMove(window, { clientX: 20, clientY: 15 })
    fireEvent.pointerCancel(window)

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('ignores secondary buttons and drags from blocked controls', () => {
    const { onReorder } = renderHarness()

    fireEvent.pointerDown(screen.getByTestId('drag-tab-third'), {
      button: 2,
      clientX: 250,
      clientY: 15,
    })
    fireEvent.pointerDown(screen.getByText('close third'), { button: 0, clientX: 250, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 20, clientY: 15 })
    fireEvent.pointerUp(window, { clientX: 20, clientY: 15 })

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('suppresses the select that follows a completed drag', () => {
    const { onSelect } = renderHarness()

    fireEvent.pointerDown(screen.getByTestId('drag-tab-third'), {
      button: 0,
      clientX: 250,
      clientY: 15,
    })
    fireEvent.pointerMove(window, { clientX: 20, clientY: 15 })
    fireEvent.pointerUp(window, { clientX: 20, clientY: 15 })
    fireEvent.click(screen.getByTestId('drag-tab-third'))

    expect(onSelect).not.toHaveBeenCalled()
  })
})
