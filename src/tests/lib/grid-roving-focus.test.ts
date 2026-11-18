import { describe, expect, it } from 'vitest'
import { isTileMoveKey, nextTileIndex, type TileRect } from '../../lib/grid-roving-focus'

function tile(column: number, row: number): TileRect {
  const left = column * 100
  const top = row * 100
  return { left: left, top: top, right: left + 90, bottom: top + 90 }
}

const THREE_THEN_ONE = [tile(0, 0), tile(1, 0), tile(2, 0), tile(0, 1)]
const NEXT_SECTION = [...THREE_THEN_ONE, tile(1, 3)]

describe('nextTileIndex', () => {
  it.each([
    ['ArrowRight', 1, THREE_THEN_ONE, 2],
    ['ArrowRight', 3, THREE_THEN_ONE, 3],
    ['ArrowLeft', 0, THREE_THEN_ONE, 0],
    ['ArrowDown', 2, THREE_THEN_ONE, 3],
    ['ArrowDown', 3, NEXT_SECTION, 4],
    ['ArrowDown', 4, NEXT_SECTION, 4],
    ['ArrowUp', 4, NEXT_SECTION, 3],
    ['ArrowUp', 1, THREE_THEN_ONE, 1],
    ['Home', 2, THREE_THEN_ONE, 0],
    ['End', 0, THREE_THEN_ONE, 3],
    ['Enter', 1, THREE_THEN_ONE, 1],
    ['End', 0, [], 0],
  ])('%s from %i', (key, currentIndex, rects, expected) => {
    expect(nextTileIndex({ key: key, currentIndex: currentIndex, rects: rects })).toBe(expected)
  })

  it('knows which keys move focus', () => {
    expect(isTileMoveKey('ArrowUp')).toBe(true)
    expect(isTileMoveKey('e')).toBe(false)
  })
})
