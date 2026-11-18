export interface TileRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface TileMove {
  key: string
  currentIndex: number
  rects: TileRect[]
}

type TileMoveHandler = (move: TileMove) => number

const ROW_OVERLAP_TOLERANCE_PX = 1
const MIDPOINT_DIVISOR = 2

function horizontalCenter(rect: TileRect): number {
  return (rect.left + rect.right) / MIDPOINT_DIVISOR
}

function lastIndex(move: TileMove): number {
  return move.rects.length - 1
}

function clampedIndex(index: number, move: TileMove): number {
  return Math.min(Math.max(index, 0), lastIndex(move))
}

interface IndexedRect {
  index: number
  rect: TileRect
}

function indexedRects(move: TileMove): IndexedRect[] {
  return move.rects.map((rect, index) => ({ index: index, rect: rect }))
}

function closestHorizontally(candidates: IndexedRect[], current: TileRect): IndexedRect {
  const currentCenter = horizontalCenter(current)
  const distanceOf = (candidate: IndexedRect) =>
    Math.abs(horizontalCenter(candidate.rect) - currentCenter)
  const closerOf = (closest: IndexedRect, candidate: IndexedRect) => {
    const isCloser = distanceOf(candidate) < distanceOf(closest)
    return isCloser ? candidate : closest
  }
  return candidates.reduce(closerOf)
}

function nearestRow(candidates: IndexedRect[], rowTop: (rect: TileRect) => number): IndexedRect[] {
  const nearestTop = Math.min(...candidates.map((candidate) => rowTop(candidate.rect)))
  return candidates.filter((candidate) => rowTop(candidate.rect) === nearestTop)
}

function indexBelow(move: TileMove): number {
  const current = move.rects[move.currentIndex]
  const below = indexedRects(move).filter(
    (candidate) => candidate.rect.top >= current.bottom - ROW_OVERLAP_TOLERANCE_PX
  )
  if (below.length === 0) return move.currentIndex
  return closestHorizontally(
    nearestRow(below, (rect) => rect.top),
    current
  ).index
}

function indexAbove(move: TileMove): number {
  const current = move.rects[move.currentIndex]
  const above = indexedRects(move).filter(
    (candidate) => candidate.rect.bottom <= current.top + ROW_OVERLAP_TOLERANCE_PX
  )
  if (above.length === 0) return move.currentIndex
  return closestHorizontally(
    nearestRow(above, (rect) => -rect.bottom),
    current
  ).index
}

const TILE_MOVES: Record<string, TileMoveHandler> = {
  ArrowRight: (move) => clampedIndex(move.currentIndex + 1, move),
  ArrowLeft: (move) => clampedIndex(move.currentIndex - 1, move),
  ArrowDown: indexBelow,
  ArrowUp: indexAbove,
  Home: () => 0,
  End: lastIndex,
}

export function isTileMoveKey(key: string): boolean {
  return key in TILE_MOVES
}

export function nextTileIndex(move: TileMove): number {
  const handler = TILE_MOVES[move.key]
  if (!handler) return move.currentIndex
  const hasTiles = move.rects.length > 0
  if (!hasTiles) return move.currentIndex
  return handler(move)
}
