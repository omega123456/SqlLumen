import { useCallback, useImperativeHandle, type RefObject } from 'react'
import {
  CompactSelection,
  type DataEditorRef,
  type GridSelection,
  type Item,
} from '@glideapps/glide-data-grid'
import type { GridCellPosition, GridHandle } from '../glide-grid-types'

const ENTER_KEY_CODE = 13
const DATA_GRID_CANVAS_SELECTOR = 'canvas[data-testid="data-grid-canvas"]'

type SelectCellOptions = Parameters<GridHandle['selectCell']>[1]

interface GlideGridHandleInput {
  hostRef: RefObject<HTMLDivElement | null>
  editorRef: RefObject<DataEditorRef | null>
  handleSelectionChange: (selection: GridSelection) => void
}

function isEditorEnabled(options: SelectCellOptions): boolean {
  return typeof options === 'object' ? options.enableEditor === true : false
}

function shouldFocusSelectedCell(options: SelectCellOptions): boolean {
  return typeof options === 'object' ? options.shouldFocusCell !== false : options !== false
}

function singleCellSelection(position: GridCellPosition): GridSelection {
  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: {
      cell: [position.idx, position.rowIdx],
      range: { x: position.idx, y: position.rowIdx, width: 1, height: 1 },
      rangeStack: [],
    },
  }
}

function dispatchEnterToCanvas(host: HTMLDivElement | null): void {
  const canvas = host?.querySelector(DATA_GRID_CANVAS_SELECTOR)
  canvas?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: ENTER_KEY_CODE,
      which: ENTER_KEY_CODE,
      bubbles: true,
    })
  )
}

export function useGlideGridHandle(ref: React.Ref<GridHandle>, input: GlideGridHandleInput): void {
  const { hostRef, editorRef, handleSelectionChange } = input

  const openSelectedCellEditor = useCallback(() => {
    requestAnimationFrame(() => {
      editorRef.current?.focus()
      dispatchEnterToCanvas(hostRef.current)
    })
  }, [editorRef, hostRef])

  useImperativeHandle(
    ref,
    () => ({
      scrollToCell: (position, axis = 'both') => {
        editorRef.current?.scrollTo(position.idx ?? 0, position.rowIdx ?? 0, axis)
      },
      selectCell: (position, options) => {
        handleSelectionChange(singleCellSelection(position))
        editorRef.current?.scrollTo(position.idx, position.rowIdx, 'both')
        if (shouldFocusSelectedCell(options)) editorRef.current?.focus()
        if (isEditorEnabled(options)) openSelectedCellEditor()
      },
      get element() {
        return hostRef.current
      },
      updateCells: (cells) => {
        editorRef.current?.updateCells(
          cells.map(([column, row]) => ({ cell: [column, row] as Item }))
        )
      },
    }),
    [editorRef, handleSelectionChange, hostRef, openSelectedCellEditor]
  )
}
