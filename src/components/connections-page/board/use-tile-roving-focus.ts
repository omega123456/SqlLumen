import { useRef, useState, type KeyboardEvent } from 'react'
import { isTileMoveKey, nextTileIndex } from '../../../lib/grid-roving-focus'

const TILE_SELECTOR = '[data-tile-key]'
const EDIT_KEYS = new Set(['e', 'E'])

function tileButtonOf(target: EventTarget): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  return target.matches(TILE_SELECTOR) ? target : null
}

function tileButtonsIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(TILE_SELECTOR))
}

function focusNextTile(tiles: HTMLElement[], currentTile: HTMLElement, key: string): void {
  const nextIndex = nextTileIndex({
    key: key,
    currentIndex: tiles.indexOf(currentTile),
    rects: tiles.map((tile) => tile.getBoundingClientRect()),
  })
  tiles[nextIndex]?.focus()
}

export function resolveActiveTileKey(activeKey: string | null, tileKeys: string[]): string | null {
  const isStillShown = activeKey !== null && tileKeys.includes(activeKey)
  if (isStillShown) return activeKey
  return tileKeys[0] ?? null
}

export function useTileRovingFocus(onEdit: (profileId: string) => void) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tile = tileButtonOf(event.target)
    if (!tile) return
    if (EDIT_KEYS.has(event.key)) {
      event.preventDefault()
      onEdit(tile.dataset.profileId ?? '')
      return
    }
    if (!isTileMoveKey(event.key)) return
    event.preventDefault()
    focusNextTile(tileButtonsIn(containerRef.current), tile, event.key)
  }

  return {
    containerRef: containerRef,
    activeKey: activeKey,
    setActiveKey: setActiveKey,
    handleKeyDown: handleKeyDown,
  }
}

export type TileRovingFocus = ReturnType<typeof useTileRovingFocus>
