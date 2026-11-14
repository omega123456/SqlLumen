import { create } from 'zustand'
import { openPalette, togglePalette } from './command-palette-store/command-palette-reducers'

export interface CommandPaletteState {
  isOpen: boolean
  openInstance: number
  scopeToTable: boolean
  open: (scopeToTable?: boolean) => void
  close: () => void
  toggle: (scopeToTable?: boolean) => void
}

export const useCommandPaletteStore = create<CommandPaletteState>()((set) => ({
  isOpen: false,
  openInstance: 0,
  scopeToTable: false,
  open: (scopeToTable = false) => set((state) => openPalette(state, scopeToTable)),
  close: () => set({ isOpen: false }),
  toggle: (scopeToTable = false) => set((state) => togglePalette(state, scopeToTable)),
}))
