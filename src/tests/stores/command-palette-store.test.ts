import { beforeEach, describe, expect, it } from 'vitest'
import { useCommandPaletteStore } from '../../stores/command-palette-store'
import {
  openPalette,
  togglePalette,
} from '../../stores/command-palette-store/command-palette-reducers'

describe('useCommandPaletteStore', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ isOpen: false, scopeToTable: false })
  })

  it('opens and closes the palette', () => {
    useCommandPaletteStore.getState().open()
    expect(useCommandPaletteStore.getState().isOpen).toBe(true)

    useCommandPaletteStore.getState().close()
    expect(useCommandPaletteStore.getState().isOpen).toBe(false)
  })

  it('toggles the palette state', () => {
    useCommandPaletteStore.getState().toggle()
    expect(useCommandPaletteStore.getState().isOpen).toBe(true)

    useCommandPaletteStore.getState().toggle()
    expect(useCommandPaletteStore.getState().isOpen).toBe(false)
  })

  it('opens in table scope only when requested', () => {
    useCommandPaletteStore.getState().toggle(true)
    expect(useCommandPaletteStore.getState().scopeToTable).toBe(true)

    useCommandPaletteStore.getState().toggle(true)
    useCommandPaletteStore.getState().toggle()
    expect(useCommandPaletteStore.getState()).toMatchObject({ isOpen: true, scopeToTable: false })

    useCommandPaletteStore.getState().open(true)
    expect(useCommandPaletteStore.getState().scopeToTable).toBe(true)
  })
})

describe('command palette reducers', () => {
  describe('command palette reducers', () => {
    it('opens a new palette instance with the requested scope', () => {
      expect(openPalette({ openInstance: 2 }, true)).toEqual({
        isOpen: true,
        openInstance: 3,
        scopeToTable: true,
      })
    })

    it('toggles between closed and a fresh open instance', () => {
      expect(togglePalette({ isOpen: true, openInstance: 1 }, false)).toEqual({ isOpen: false })
      expect(togglePalette({ isOpen: false, openInstance: 1 }, false)).toEqual({
        isOpen: true,
        openInstance: 2,
        scopeToTable: false,
      })
    })
  })
})
