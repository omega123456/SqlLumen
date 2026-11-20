import { useCallback, useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import type { TextTableLayout } from '../text-format'

export const LINES_PER_BLOCK = 32

const CHARACTERS_PER_CHUNK = 64

const MARGIN_CHUNKS = 1

export interface TextSpan {
  first: number
  end: number
}

export interface VisibleTextWindow {
  lines: TextSpan
  characters: TextSpan
}

interface TextViewport {
  scrollTop: number
  scrollLeft: number
  viewportHeight: number
  viewportWidth: number
}

interface TextGrid {
  lineCount: number
  lineLength: number
  lineHeight: number
  characterWidth: number
}

interface AxisScroll {
  offset: number
  extent: number
  unitSize: number
}

interface AxisChunking {
  chunkSize: number
  unitCount: number
}

const EMPTY_SPAN: TextSpan = { first: 0, end: 0 }

const EMPTY_WINDOW: VisibleTextWindow = { lines: EMPTY_SPAN, characters: EMPTY_SPAN }

function clampToUnits(unit: number, unitCount: number): number {
  return Math.min(Math.max(unit, 0), unitCount)
}

function clampSpan(span: TextSpan, unitCount: number): TextSpan {
  return { first: clampToUnits(span.first, unitCount), end: clampToUnits(span.end, unitCount) }
}

function chunkAlignedSpan(scroll: AxisScroll, chunking: AxisChunking): TextSpan {
  const { chunkSize } = chunking
  const firstVisible = Math.floor(scroll.offset / scroll.unitSize)
  const endVisible = Math.ceil((scroll.offset + scroll.extent) / scroll.unitSize)
  const first = (Math.floor(firstVisible / chunkSize) - MARGIN_CHUNKS) * chunkSize
  const end = (Math.ceil(endVisible / chunkSize) + MARGIN_CHUNKS) * chunkSize
  return clampSpan({ first, end }, chunking.unitCount)
}

function lineSpanOf(viewport: TextViewport, grid: TextGrid): TextSpan {
  return chunkAlignedSpan(
    { offset: viewport.scrollTop, extent: viewport.viewportHeight, unitSize: grid.lineHeight },
    { chunkSize: LINES_PER_BLOCK, unitCount: grid.lineCount }
  )
}

function characterSpanOf(viewport: TextViewport, grid: TextGrid): TextSpan {
  const isUnmeasured = grid.characterWidth === 0
  if (isUnmeasured) return { first: 0, end: grid.lineLength }
  return chunkAlignedSpan(
    { offset: viewport.scrollLeft, extent: viewport.viewportWidth, unitSize: grid.characterWidth },
    { chunkSize: CHARACTERS_PER_CHUNK, unitCount: grid.lineLength }
  )
}

function visibleTextWindow(viewport: TextViewport, grid: TextGrid): VisibleTextWindow {
  return { lines: lineSpanOf(viewport, grid), characters: characterSpanOf(viewport, grid) }
}

function viewportOf(scroller: HTMLElement): TextViewport {
  return {
    scrollTop: scroller.scrollTop,
    scrollLeft: scroller.scrollLeft,
    viewportHeight: scroller.clientHeight,
    viewportWidth: scroller.clientWidth,
  }
}

function characterWidthOf(spacer: HTMLElement, lineLength: number): number {
  if (lineLength === 0) return 0
  return spacer.offsetWidth / lineLength
}

function isSameSpan(left: TextSpan, right: TextSpan): boolean {
  return left.first === right.first && left.end === right.end
}

function isSameWindow(left: VisibleTextWindow, right: VisibleTextWindow): boolean {
  return isSameSpan(left.lines, right.lines) && isSameSpan(left.characters, right.characters)
}

function clampWindowToLayout(
  textWindow: VisibleTextWindow,
  layout: TextTableLayout
): VisibleTextWindow {
  return {
    lines: clampSpan(textWindow.lines, layout.rowCount),
    characters: clampSpan(textWindow.characters, layout.lineLength),
  }
}

function observeElements(observer: ResizeObserver, elements: Array<HTMLElement | null>): void {
  for (const element of elements) {
    if (element === null) continue
    observer.observe(element)
  }
}

interface VisibleTextWindowRequest {
  scrollRef: RefObject<HTMLElement | null>
  spacerRef: RefObject<HTMLElement | null>
  layout: TextTableLayout
  lineHeight: number
}

export function useVisibleTextWindow({
  scrollRef,
  spacerRef,
  layout,
  lineHeight,
}: VisibleTextWindowRequest) {
  const [textWindow, setTextWindow] = useState<VisibleTextWindow>(EMPTY_WINDOW)
  const { rowCount, lineLength } = layout

  const measure = useCallback(() => {
    const scroller = scrollRef.current
    const spacer = spacerRef.current
    if (scroller === null) return
    if (spacer === null) return
    const grid: TextGrid = {
      lineCount: rowCount,
      lineLength: lineLength,
      lineHeight: lineHeight,
      characterWidth: characterWidthOf(spacer, lineLength),
    }
    const nextWindow = visibleTextWindow(viewportOf(scroller), grid)
    setTextWindow((currentWindow) =>
      isSameWindow(currentWindow, nextWindow) ? currentWindow : nextWindow
    )
  }, [scrollRef, spacerRef, rowCount, lineLength, lineHeight])

  useLayoutEffect(() => {
    measure()
    const observer = new ResizeObserver(() => measure())
    observeElements(observer, [scrollRef.current, spacerRef.current])
    return () => observer.disconnect()
  }, [scrollRef, spacerRef, measure])

  const clampedWindow = useMemo(() => clampWindowToLayout(textWindow, layout), [textWindow, layout])

  return { textWindow: clampedWindow, onScroll: measure }
}
