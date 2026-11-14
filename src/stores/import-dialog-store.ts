import { create } from 'zustand'

interface ImportDialogState {
  request: { connectionId: string; filePath: string } | null
  openImportDialog: (connectionId: string, filePath: string) => void
  closeImportDialog: () => void
}

export const useImportDialogStore = create<ImportDialogState>()((set) => ({
  request: null,
  openImportDialog: (connectionId, filePath) => {
    set({ request: { connectionId, filePath } })
  },
  closeImportDialog: () => {
    set({ request: null })
  },
}))
