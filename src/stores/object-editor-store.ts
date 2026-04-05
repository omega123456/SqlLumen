/**
 * Zustand store for object-editor tabs (views, procedures, functions, triggers, events).
 * Follows the per-tab pattern from table-designer-store.
 */

import { create } from 'zustand'
import type { EditableObjectType, SaveObjectResponse } from '../types/schema'
import { getObjectBody, saveObject } from '../lib/object-editor-commands'
import { getObjectTemplate } from '../components/object-editor/object-editor-templates'
import { showSuccessToast, showErrorToast } from './toast-store'
import { useSchemaStore } from './schema-store'

// ---------------------------------------------------------------------------
// Per-tab state
// ---------------------------------------------------------------------------

export interface ObjectEditorTabState {
  connectionId: string
  database: string
  objectName: string
  objectType: EditableObjectType
  mode: 'create' | 'alter'
  content: string
  originalContent: string
  isLoading: boolean
  isSaving: boolean
  error: string | null
  pendingNavigationAction: (() => void) | null
  /** Set after successful create-mode save, for component to read. */
  savedObjectName: string | null
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface ObjectEditorStore {
  tabs: Record<string, ObjectEditorTabState>

  initTab: (
    tabId: string,
    meta: {
      connectionId: string
      database: string
      objectName: string
      objectType: EditableObjectType
      mode: 'create' | 'alter'
    }
  ) => void
  setContent: (tabId: string, content: string) => void
  loadBody: (tabId: string) => Promise<void>
  saveBody: (tabId: string) => Promise<void>
  cleanupTab: (tabId: string) => void
  requestNavigationAction: (tabId: string, action: () => void) => void
  clearPendingAction: (tabId: string) => void
  cancelPendingAction: (tabId: string) => void
  isDirty: (tabId: string) => boolean
  consumeSavedObjectName: (tabId: string) => string | null
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useObjectEditorStore = create<ObjectEditorStore>()((set, get) => {
  const patchTab = (tabId: string, partial: Partial<ObjectEditorTabState>) => {
    set((state) => {
      const existing = state.tabs[tabId]
      if (!existing) return state
      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...existing, ...partial },
        },
      }
    })
  }

  return {
    tabs: {},

    initTab: (tabId, meta) => {
      set((state) => {
        if (state.tabs[tabId]) return state
        return {
          tabs: {
            ...state.tabs,
            [tabId]: {
              connectionId: meta.connectionId,
              database: meta.database,
              objectName: meta.objectName,
              objectType: meta.objectType,
              mode: meta.mode,
              content: '',
              originalContent: '',
              isLoading: false,
              isSaving: false,
              error: null,
              pendingNavigationAction: null,
              savedObjectName: null,
            },
          },
        }
      })
    },

    setContent: (tabId, content) => {
      patchTab(tabId, { content })
    },

    loadBody: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      if (tab.mode === 'create') {
        const template = getObjectTemplate(tab.objectType, tab.database)
        patchTab(tabId, {
          content: template,
          originalContent: template,
          isLoading: false,
          error: null,
        })
        return
      }

      // Alter mode — fetch from backend
      patchTab(tabId, { isLoading: true, error: null })

      try {
        const body = await getObjectBody(
          tab.connectionId,
          tab.database,
          tab.objectName,
          tab.objectType
        )

        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          content: body,
          originalContent: body,
          isLoading: false,
          error: null,
        })
      } catch (err) {
        if (!get().tabs[tabId]) return

        const errorMsg = err instanceof Error ? err.message : String(err)
        patchTab(tabId, {
          isLoading: false,
          error: errorMsg,
        })
      }
    },

    saveBody: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      patchTab(tabId, { isSaving: true })

      let response: SaveObjectResponse
      try {
        response = await saveObject(
          tab.connectionId,
          tab.database,
          tab.objectName,
          tab.objectType,
          tab.content,
          tab.mode
        )
      } catch (err) {
        if (!get().tabs[tabId]) return

        const errorMsg = err instanceof Error ? err.message : String(err)
        showErrorToast('Save failed', errorMsg)
        patchTab(tabId, { isSaving: false, error: errorMsg })
        return
      }

      if (!get().tabs[tabId]) return

      if (response.success) {
        showSuccessToast(`${tab.objectType} saved successfully`)

        const updates: Partial<ObjectEditorTabState> = {
          originalContent: tab.content,
          isSaving: false,
          error: null,
        }

        // If create mode, set savedObjectName, transition to alter, and update objectName
        if (tab.mode === 'create') {
          updates.savedObjectName = response.savedObjectName ?? null
          updates.mode = 'alter'
          if (response.savedObjectName) {
            updates.objectName = response.savedObjectName
          }
        }

        patchTab(tabId, updates)

        // Refresh schema tree — call both refreshCategory and refreshDatabase
        // refreshCategory may silently no-op if the category node hasn't been expanded,
        // so always also call refreshDatabase to ensure tree awareness.
        try {
          await useSchemaStore
            .getState()
            .refreshCategory(tab.connectionId, tab.database, tab.objectType)
        } catch {
          // Ignore refreshCategory errors
        }
        try {
          await useSchemaStore.getState().refreshDatabase(tab.connectionId, tab.database)
        } catch {
          // Ignore refresh errors — the save itself succeeded
        }
      } else {
        const errorMsg = response.errorMessage ?? 'Unknown error'
        showErrorToast('Save failed', errorMsg)
        patchTab(tabId, { isSaving: false, error: errorMsg })
      }
    },

    cleanupTab: (tabId) => {
      set((state) => {
        if (!state.tabs[tabId]) return state
        const nextTabs = { ...state.tabs }
        delete nextTabs[tabId]
        return { tabs: nextTabs }
      })
    },

    requestNavigationAction: (tabId, action) => {
      patchTab(tabId, { pendingNavigationAction: action })
    },

    clearPendingAction: (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return
      const action = tab.pendingNavigationAction
      patchTab(tabId, { pendingNavigationAction: null })
      action?.()
    },

    cancelPendingAction: (tabId) => {
      patchTab(tabId, { pendingNavigationAction: null })
    },

    isDirty: (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return false
      return tab.content !== tab.originalContent
    },

    consumeSavedObjectName: (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return null
      const name = tab.savedObjectName
      if (name !== null) {
        patchTab(tabId, { savedObjectName: null })
      }
      return name
    },
  }
})
