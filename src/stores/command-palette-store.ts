import { create } from 'zustand'

interface CommandPaletteState {
  isOpen: boolean
  openInstance: number
  /** When true, the palette opens pre-filled with the active table's database/table pills. */
  scopeToTable: boolean
  open: (scopeToTable?: boolean) => void
  close: () => void
  toggle: (scopeToTable?: boolean) => void
}

export const useCommandPaletteStore = create<CommandPaletteState>()((set) => ({
  isOpen: false,
  openInstance: 0,
  scopeToTable: false,
  open: (scopeToTable = false) =>
    set((state) => ({
      isOpen: true,
      openInstance: state.openInstance + 1,
      scopeToTable,
    })),
  close: () => set({ isOpen: false }),
  toggle: (scopeToTable = false) =>
    set((state) =>
      state.isOpen
        ? { isOpen: false }
        : { isOpen: true, openInstance: state.openInstance + 1, scopeToTable }
    ),
}))
