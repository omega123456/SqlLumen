import { beforeEach, describe, expect, it } from 'vitest'
import { useCommandPaletteStore } from '../../stores/command-palette-store'

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
