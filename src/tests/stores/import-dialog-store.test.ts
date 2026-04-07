import { describe, it, expect, beforeEach } from 'vitest'
import { useImportDialogStore } from '../../stores/import-dialog-store'

beforeEach(() => {
  useImportDialogStore.setState({ request: null })
})

describe('import-dialog-store', () => {
  it('starts with null request', () => {
    expect(useImportDialogStore.getState().request).toBeNull()
  })

  it('openImportDialog sets request with connectionId and filePath', () => {
    useImportDialogStore.getState().openImportDialog('conn-1', '/tmp/import.sql')

    const state = useImportDialogStore.getState()
    expect(state.request).toEqual({
      connectionId: 'conn-1',
      filePath: '/tmp/import.sql',
    })
  })

  it('closeImportDialog clears the request', () => {
    useImportDialogStore.getState().openImportDialog('conn-1', '/tmp/import.sql')
    expect(useImportDialogStore.getState().request).not.toBeNull()

    useImportDialogStore.getState().closeImportDialog()
    expect(useImportDialogStore.getState().request).toBeNull()
  })
})
