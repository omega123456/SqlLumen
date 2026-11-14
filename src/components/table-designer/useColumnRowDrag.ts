import { useRef, useState, type PointerEvent } from 'react'
import { isTargetWithin } from '../../lib/input-events'
import { dropIndexFor, type RowDrag } from './column-editor-model'

const DRAG_THRESHOLD_PX = 4
const DRAG_IGNORE_SELECTOR = 'input, textarea, select, button, a, [role="combobox"]'
const PRIMARY_POINTER_BUTTON = 0
const MIN_ROW_HEIGHT_PX = 1

interface PointerRowDrag {
  from: number
  startY: number
  to: number | null
}

export interface RowMove {
  from: number
  to: number
}

export interface ColumnRowDragInputs {
  columnCount: number
  onSelect: (columnIndex: number) => void
  onReorder: (move: RowMove) => void
}

export interface ColumnRowDragHandlers {
  onRowClick: (columnIndex: number) => void
  onPointerDown: (event: PointerEvent<HTMLTableRowElement>, columnIndex: number) => void
  onPointerMove: (event: PointerEvent<HTMLTableRowElement>) => void
  onPointerUp: (event: PointerEvent<HTMLTableRowElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLTableRowElement>) => void
}

export interface ColumnRowDrag {
  drag: RowDrag | null
  handlers: ColumnRowDragHandlers
}

function isDragStartPointer(event: PointerEvent<HTMLTableRowElement>): boolean {
  if (event.button !== PRIMARY_POINTER_BUTTON) return false
  return !isTargetWithin(event.target, DRAG_IGNORE_SELECTOR)
}

function isBelowDragThreshold(rowDrag: PointerRowDrag, offset: number): boolean {
  const hasNotStarted = rowDrag.to === null
  return hasNotStarted && Math.abs(offset) < DRAG_THRESHOLD_PX
}

function nextDrag(current: RowDrag | null, candidate: RowDrag): RowDrag {
  if (current?.to === candidate.to) return current
  return candidate
}

function followPointer(
  rowDrag: PointerRowDrag,
  event: PointerEvent<HTMLTableRowElement>,
  columnCount: number
): RowDrag | null {
  const offset = event.clientY - rowDrag.startY
  if (isBelowDragThreshold(rowDrag, offset)) return null
  const row = event.currentTarget
  row.style.transform = `translateY(${offset}px)`
  const rowHeight = row.offsetHeight || MIN_ROW_HEIGHT_PX
  const to = dropIndexFor({
    from: rowDrag.from,
    offset: offset,
    rowHeight: rowHeight,
    columnCount: columnCount,
  })
  rowDrag.to = to
  return { from: rowDrag.from, to: to, rowHeight: rowHeight }
}

export function useColumnRowDrag({
  columnCount,
  onSelect,
  onReorder,
}: ColumnRowDragInputs): ColumnRowDrag {
  const [drag, setDrag] = useState<RowDrag | null>(null)
  const rowDragRef = useRef<PointerRowDrag | null>(null)
  const suppressRowClickRef = useRef(false)

  const onRowClick = (columnIndex: number) => {
    if (suppressRowClickRef.current) {
      suppressRowClickRef.current = false
      return
    }
    onSelect(columnIndex)
  }

  const onPointerDown = (event: PointerEvent<HTMLTableRowElement>, columnIndex: number) => {
    suppressRowClickRef.current = false
    if (!isDragStartPointer(event)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    rowDragRef.current = { from: columnIndex, startY: event.clientY, to: null }
  }

  const onPointerMove = (event: PointerEvent<HTMLTableRowElement>) => {
    const rowDrag = rowDragRef.current
    if (!rowDrag) return
    const candidate = followPointer(rowDrag, event, columnCount)
    if (!candidate) return
    setDrag((current) => nextDrag(current, candidate))
  }

  const finishRowDrag = (row: HTMLTableRowElement, commit: boolean) => {
    const rowDrag = rowDragRef.current
    rowDragRef.current = null
    row.style.transform = ''
    if (rowDrag?.to == null) return

    const move = { from: rowDrag.from, to: rowDrag.to }
    suppressRowClickRef.current = true
    setDrag(null)
    const hasMoved = move.from !== move.to
    const shouldReorder = commit && hasMoved
    if (shouldReorder) {
      onReorder(move)
    }
  }

  return {
    drag: drag,
    handlers: {
      onRowClick: onRowClick,
      onPointerDown: onPointerDown,
      onPointerMove: onPointerMove,
      onPointerUp: (event) => finishRowDrag(event.currentTarget, true),
      onPointerCancel: (event) => finishRowDrag(event.currentTarget, false),
    },
  }
}
