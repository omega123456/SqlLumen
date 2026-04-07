import { create } from 'zustand'

interface ImportDialogState {
  /** When non-null, the import dialog should be shown. */
  request: { connectionId: string; filePath: string } | null
  /** Open the import dialog with the given connection and file path. */
  openImportDialog: (connectionId: string, filePath: string) => void
  /** Close the import dialog. */
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
