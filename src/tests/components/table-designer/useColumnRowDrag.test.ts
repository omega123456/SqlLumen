import { act, renderHook } from '@testing-library/react'
import type { PointerEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useColumnRowDrag } from '../../../components/table-designer/useColumnRowDrag'

const ROW_HEIGHT_PX = 30

function makeRow(): HTMLTableRowElement {
  const row = document.createElement('tr')
  Object.defineProperty(row, 'offsetHeight', { value: ROW_HEIGHT_PX })
  row.setPointerCapture = vi.fn()
  return row
}

interface PointerInit {
  row: HTMLTableRowElement
  clientY: number
  button?: number
  target?: EventTarget
}

function pointerEvent({ row, clientY, button = 0, target = row }: PointerInit) {
  return {
    button: button,
    target: target,
    clientY: clientY,
    pointerId: 1,
    currentTarget: row,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent<HTMLTableRowElement>
}

function renderDrag() {
  const onSelect = vi.fn()
  const onReorder = vi.fn()
  const hook = renderHook(() =>
    useColumnRowDrag({ columnCount: 4, onSelect: onSelect, onReorder: onReorder })
  )
  return { hook: hook, onSelect: onSelect, onReorder: onReorder }
}

describe('useColumnRowDrag', () => {
  it('selects the clicked row when no drag happened', () => {
    const { hook, onSelect } = renderDrag()
    act(() => hook.result.current.handlers.onRowClick(2))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('reorders after a drag past the threshold and swallows the closing click', () => {
    const { hook, onSelect, onReorder } = renderDrag()
    const row = makeRow()
    act(() => hook.result.current.handlers.onPointerDown(pointerEvent({ row, clientY: 0 }), 0))
    act(() => hook.result.current.handlers.onPointerMove(pointerEvent({ row, clientY: 62 })))
    expect(hook.result.current.drag).toEqual({ from: 0, to: 2, rowHeight: ROW_HEIGHT_PX })
    expect(row.style.transform).toBe('translateY(62px)')

    act(() => hook.result.current.handlers.onPointerUp(pointerEvent({ row, clientY: 62 })))
    expect(onReorder).toHaveBeenCalledWith({ from: 0, to: 2 })
    expect(hook.result.current.drag).toBeNull()
    expect(row.style.transform).toBe('')

    act(() => hook.result.current.handlers.onRowClick(0))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ignores moves below the drag threshold', () => {
    const { hook, onReorder } = renderDrag()
    const row = makeRow()
    act(() => hook.result.current.handlers.onPointerDown(pointerEvent({ row, clientY: 0 }), 1))
    act(() => hook.result.current.handlers.onPointerMove(pointerEvent({ row, clientY: 2 })))
    act(() => hook.result.current.handlers.onPointerUp(pointerEvent({ row, clientY: 2 })))
    expect(hook.result.current.drag).toBeNull()
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('does not reorder a cancelled drag', () => {
    const { hook, onReorder } = renderDrag()
    const row = makeRow()
    act(() => hook.result.current.handlers.onPointerDown(pointerEvent({ row, clientY: 0 }), 0))
    act(() => hook.result.current.handlers.onPointerMove(pointerEvent({ row, clientY: 40 })))
    act(() => hook.result.current.handlers.onPointerCancel(pointerEvent({ row, clientY: 40 })))
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('does not start a drag from a secondary button or an input', () => {
    const { hook } = renderDrag()
    const row = makeRow()
    const input = document.createElement('input')
    row.appendChild(input)
    act(() =>
      hook.result.current.handlers.onPointerDown(pointerEvent({ row, clientY: 0, button: 2 }), 0)
    )
    act(() =>
      hook.result.current.handlers.onPointerDown(
        pointerEvent({ row, clientY: 0, target: input }),
        0
      )
    )
    act(() => hook.result.current.handlers.onPointerMove(pointerEvent({ row, clientY: 60 })))
    expect(hook.result.current.drag).toBeNull()
    expect(row.setPointerCapture).not.toHaveBeenCalled()
  })
})
