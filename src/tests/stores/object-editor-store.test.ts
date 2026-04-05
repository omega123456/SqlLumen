import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// Mock IPC before importing the store
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock the app-log-commands (used by toast-store)
vi.mock('../../lib/app-log-commands', () => ({
  logFrontend: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useSchemaStore } from '../../stores/schema-store'
import { useToastStore, _resetToastTimeoutsForTests } from '../../stores/toast-store'

const mockInvoke = vi.mocked(invoke)

function resetStores() {
  useObjectEditorStore.setState({ tabs: {} })
  useToastStore.setState({ toasts: [] })
  _resetToastTimeoutsForTests()
}

beforeEach(() => {
  mockInvoke.mockReset()
  resetStores()
})

afterEach(() => {
  resetStores()
})

const defaultMeta = {
  connectionId: 'conn-1',
  database: 'test_db',
  objectName: 'my_proc',
  objectType: 'procedure' as const,
  mode: 'alter' as const,
}

describe('ObjectEditorStore', () => {
  describe('initTab', () => {
    it('sets up correct initial state', () => {
      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)

      const tab = useObjectEditorStore.getState().tabs['tab-1']
      expect(tab).toBeDefined()
      expect(tab.connectionId).toBe('conn-1')
      expect(tab.database).toBe('test_db')
      expect(tab.objectName).toBe('my_proc')
      expect(tab.objectType).toBe('procedure')
      expect(tab.mode).toBe('alter')
      expect(tab.content).toBe('')
      expect(tab.originalContent).toBe('')
      expect(tab.isLoading).toBe(false)
      expect(tab.isSaving).toBe(false)
      expect(tab.error).toBeNull()
      expect(tab.pendingNavigationAction).toBeNull()
      expect(tab.savedObjectName).toBeNull()
    })

    it('does not overwrite existing tab state', () => {
      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      store.setContent('tab-1', 'modified content')

      store.initTab('tab-1', { ...defaultMeta, objectName: 'different' })

      const tab = useObjectEditorStore.getState().tabs['tab-1']
      expect(tab.content).toBe('modified content')
      expect(tab.objectName).toBe('my_proc')
    })
  })

  describe('setContent', () => {
    it('updates content for a tab', () => {
      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      store.setContent('tab-1', 'SELECT 1')

      expect(useObjectEditorStore.getState().tabs['tab-1'].content).toBe('SELECT 1')
    })

    it('does nothing for non-existent tab', () => {
      const store = useObjectEditorStore.getState()
      store.setContent('nonexistent', 'test')

      expect(useObjectEditorStore.getState().tabs['nonexistent']).toBeUndefined()
    })
  })

  describe('isDirty', () => {
    it('returns false when content equals originalContent', () => {
      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)

      expect(store.isDirty('tab-1')).toBe(false)
    })

    it('returns true when content differs from originalContent', () => {
      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      store.setContent('tab-1', 'modified')

      expect(useObjectEditorStore.getState().isDirty('tab-1')).toBe(true)
    })

    it('returns false for non-existent tab', () => {
      expect(useObjectEditorStore.getState().isDirty('nonexistent')).toBe(false)
    })
  })

  describe('loadBody', () => {
    it('fetches body from IPC in alter mode', async () => {
      mockInvoke.mockResolvedValue('CREATE PROCEDURE body...')

      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      await store.loadBody('tab-1')

      const tab = useObjectEditorStore.getState().tabs['tab-1']
      expect(tab.content).toBe('CREATE PROCEDURE body...')
      expect(tab.originalContent).toBe('CREATE PROCEDURE body...')
      expect(tab.isLoading).toBe(false)
      expect(tab.error).toBeNull()
    })

    it('loads template in create mode', async () => {
      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', { ...defaultMeta, mode: 'create' })
      await store.loadBody('tab-1')

      const tab = useObjectEditorStore.getState().tabs['tab-1']
      expect(tab.content).toContain('CREATE PROCEDURE')
      expect(tab.content).toContain('`test_db`')
      expect(tab.originalContent).toBe(tab.content)
      expect(tab.isLoading).toBe(false)
      expect(tab.error).toBeNull()
    })

    it('sets error state on IPC failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Connection lost'))

      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      await store.loadBody('tab-1')

      const tab = useObjectEditorStore.getState().tabs['tab-1']
      expect(tab.isLoading).toBe(false)
      expect(tab.error).toBe('Connection lost')
    })

    it('sets isLoading true during fetch in alter mode', async () => {
      let loadingDuringFetch = false
      mockInvoke.mockImplementation(() => {
        loadingDuringFetch = useObjectEditorStore.getState().tabs['tab-1']?.isLoading ?? false
        return Promise.resolve('body')
      })

      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      await store.loadBody('tab-1')

      expect(loadingDuringFetch).toBe(true)
    })

    it('does nothing for non-existent tab', async () => {
      await useObjectEditorStore.getState().loadBody('nonexistent')
      // No error thrown
    })

    it('handles tab closed during fetch', async () => {
      mockInvoke.mockImplementation(async () => {
        // Simulate tab being closed during IPC
        useObjectEditorStore.getState().cleanupTab('tab-1')
        return 'body'
      })

      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      await store.loadBody('tab-1')

      expect(useObjectEditorStore.getState().tabs['tab-1']).toBeUndefined()
    })
  })

  describe('saveBody', () => {
    it('updates originalContent and shows success toast on success', async () => {
      mockInvoke.mockImplementation(async (cmd) => {
        if (cmd === 'get_object_body') return 'original body'
        if (cmd === 'save_object') {
          return {
            success: true,
            errorMessage: null,
            dropSucceeded: false,
            savedObjectName: null,
          }
        }
        return undefined
      })

      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      await store.loadBody('tab-1')
      store.setContent('tab-1', 'modified body')

      await useObjectEditorStore.getState().saveBody('tab-1')

      const tab = useObjectEditorStore.getState().tabs['tab-1']
      expect(tab.originalContent).toBe('modified body')
      expect(tab.isSaving).toBe(false)
      // Check success toast was shown
      const toasts = useToastStore.getState().toasts
      expect(toasts.some((t) => t.variant === 'success')).toBe(true)
    })

    it('sets savedObjectName in create mode', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        errorMessage: null,
        dropSucceeded: false,
        savedObjectName: 'new_proc',
      })

      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', { ...defaultMeta, mode: 'create' })
      store.setContent('tab-1', 'CREATE PROCEDURE...')

      await useObjectEditorStore.getState().saveBody('tab-1')

      const tab = useObjectEditorStore.getState().tabs['tab-1']
      expect(tab.savedObjectName).toBe('new_proc')
      expect(tab.mode).toBe('alter')
    })

    it('does not set savedObjectName in alter mode', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        errorMessage: null,
        dropSucceeded: false,
        savedObjectName: 'my_proc',
      })

      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      store.setContent('tab-1', 'modified')

      await useObjectEditorStore.getState().saveBody('tab-1')

      const tab = useObjectEditorStore.getState().tabs['tab-1']
      expect(tab.savedObjectName).toBeNull()
      expect(tab.mode).toBe('alter')
    })

    it('shows error toast and keeps content on failure response', async () => {
      mockInvoke.mockResolvedValue({
        success: false,
        errorMessage: 'Syntax error near BEGIN',
        dropSucceeded: false,
        savedObjectName: null,
      })

      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      store.setContent('tab-1', 'bad content')

      await useObjectEditorStore.getState().saveBody('tab-1')

      const tab = useObjectEditorStore.getState().tabs['tab-1']
      expect(tab.content).toBe('bad content')
      expect(tab.originalContent).toBe('')
      expect(tab.isSaving).toBe(false)
      const toasts = useToastStore.getState().toasts
      expect(toasts.some((t) => t.variant === 'error')).toBe(true)
    })

    it('shows error toast on IPC error', async () => {
      mockInvoke.mockRejectedValue(new Error('Network error'))

      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      store.setContent('tab-1', 'content')

      await useObjectEditorStore.getState().saveBody('tab-1')

      const tab = useObjectEditorStore.getState().tabs['tab-1']
      expect(tab.isSaving).toBe(false)
      const toasts = useToastStore.getState().toasts
      expect(toasts.some((t) => t.variant === 'error' && t.message === 'Network error')).toBe(true)
    })

    it('refreshes schema category on success', async () => {
      const refreshCategorySpy = vi.spyOn(useSchemaStore.getState(), 'refreshCategory')
      refreshCategorySpy.mockResolvedValue(undefined)

      mockInvoke.mockResolvedValue({
        success: true,
        errorMessage: null,
        dropSucceeded: false,
        savedObjectName: null,
      })

      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      store.setContent('tab-1', 'content')

      await useObjectEditorStore.getState().saveBody('tab-1')

      expect(refreshCategorySpy).toHaveBeenCalledWith('conn-1', 'test_db', 'procedure')
      refreshCategorySpy.mockRestore()
    })

    it('falls back to refreshDatabase when refreshCategory fails', async () => {
      const refreshCategorySpy = vi.spyOn(useSchemaStore.getState(), 'refreshCategory')
      refreshCategorySpy.mockRejectedValue(new Error('Category not found'))
      const refreshDatabaseSpy = vi.spyOn(useSchemaStore.getState(), 'refreshDatabase')
      refreshDatabaseSpy.mockResolvedValue(undefined)

      mockInvoke.mockResolvedValue({
        success: true,
        errorMessage: null,
        dropSucceeded: false,
        savedObjectName: null,
      })

      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)

      await useObjectEditorStore.getState().saveBody('tab-1')

      expect(refreshDatabaseSpy).toHaveBeenCalledWith('conn-1', 'test_db')
      refreshCategorySpy.mockRestore()
      refreshDatabaseSpy.mockRestore()
    })

    it('does nothing for non-existent tab', async () => {
      await useObjectEditorStore.getState().saveBody('nonexistent')
      // No error thrown
    })
  })

  describe('cleanupTab', () => {
    it('removes tab state', () => {
      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      expect(useObjectEditorStore.getState().tabs['tab-1']).toBeDefined()

      store.cleanupTab('tab-1')
      expect(useObjectEditorStore.getState().tabs['tab-1']).toBeUndefined()
    })

    it('does nothing for non-existent tab', () => {
      useObjectEditorStore.getState().cleanupTab('nonexistent')
      // No error thrown
    })
  })

  describe('requestNavigationAction', () => {
    it('sets pendingNavigationAction', () => {
      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      const action = vi.fn()
      store.requestNavigationAction('tab-1', action)

      expect(useObjectEditorStore.getState().tabs['tab-1'].pendingNavigationAction).toBe(action)
    })
  })

  describe('clearPendingAction', () => {
    it('clears pending action and executes it', () => {
      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      const action = vi.fn()
      store.requestNavigationAction('tab-1', action)

      useObjectEditorStore.getState().clearPendingAction('tab-1')

      expect(action).toHaveBeenCalledTimes(1)
      expect(useObjectEditorStore.getState().tabs['tab-1'].pendingNavigationAction).toBeNull()
    })

    it('does nothing for non-existent tab', () => {
      useObjectEditorStore.getState().clearPendingAction('nonexistent')
      // No error thrown
    })

    it('handles tab with no pending action', () => {
      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)

      useObjectEditorStore.getState().clearPendingAction('tab-1')

      expect(useObjectEditorStore.getState().tabs['tab-1'].pendingNavigationAction).toBeNull()
    })
  })

  describe('cancelPendingAction', () => {
    it('clears pending action without executing it', () => {
      const store = useObjectEditorStore.getState()
      store.initTab('tab-1', defaultMeta)
      const action = vi.fn()
      store.requestNavigationAction('tab-1', action)

      useObjectEditorStore.getState().cancelPendingAction('tab-1')

      expect(action).not.toHaveBeenCalled()
      expect(useObjectEditorStore.getState().tabs['tab-1'].pendingNavigationAction).toBeNull()
    })

    it('does nothing for non-existent tab', () => {
      useObjectEditorStore.getState().cancelPendingAction('nonexistent')
      // No error thrown
    })
  })
})
