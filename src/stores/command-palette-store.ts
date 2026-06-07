import { create } from 'zustand'

interface CommandPaletteState {
  isOpen: boolean
  openInstance: number
  open: () => void
  close: () => void
  toggle: () => void
}

export const useCommandPaletteStore = create<CommandPaletteState>()((set) => ({
  isOpen: false,
  openInstance: 0,
  open: () =>
    set((state) => ({
      isOpen: true,
      openInstance: state.openInstance + 1,
    })),
  close: () => set({ isOpen: false }),
  toggle: () =>
    set((state) => ({
      isOpen: !state.isOpen,
      openInstance: state.isOpen ? state.openInstance : state.openInstance + 1,
    })),
}))
