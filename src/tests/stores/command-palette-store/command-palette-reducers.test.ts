import { describe, expect, it } from 'vitest'
import {
  openPalette,
  togglePalette,
} from '../../../stores/command-palette-store/command-palette-reducers'

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
