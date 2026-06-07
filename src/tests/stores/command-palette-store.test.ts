import { beforeEach, describe, expect, it } from 'vitest'
import { useCommandPaletteStore } from '../../stores/command-palette-store'

describe('useCommandPaletteStore', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ isOpen: false })
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
})
