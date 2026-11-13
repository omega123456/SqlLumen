/**
 * Zustand store for object-editor tabs (views, procedures, functions, triggers, events).
 * Follows the per-tab pattern from table-designer-store.
 */

import { create } from 'zustand'
import type { EditableObjectType, SaveObjectResponse } from '../types/schema'
import { logFrontend } from '../lib/app-log-commands'
import { getObjectBody, saveObject } from '../lib/object-editor-commands'
import { getObjectTemplate } from '../components/object-editor/object-editor-templates'
import { showSuccessToast, showErrorToast } from './toast-store'
import { useSchemaStore } from './schema-store'
import { invalidateRoutineCache } from '../components/query-editor/routine-parameter-cache'
import { invalidateCache as invalidateSchemaMetadataCache } from '../components/query-editor/schema-metadata-cache'
import { toErrorMessage } from '../lib/error-message'
import {
  initObjectEditorTab,
  patchObjectEditorTabState,
  removeObjectEditorTab,
} from './object-editor-store/object-editor-reducers'

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

function createdObjectUpdates(response: SaveObjectResponse): Partial<ObjectEditorTabState> {
  const updates: Partial<ObjectEditorTabState> = {
    savedObjectName: response.savedObjectName ?? null,
    mode: 'alter',
  }
  if (response.savedObjectName) {
    updates.objectName = response.savedObjectName
  }
  return updates
}

function savedTabUpdates(
  tab: ObjectEditorTabState,
  response: SaveObjectResponse
): Partial<ObjectEditorTabState> {
  const updates: Partial<ObjectEditorTabState> = {
    originalContent: tab.content,
    isSaving: false,
    error: null,
  }
  if (tab.mode !== 'create') return updates
  return { ...updates, ...createdObjectUpdates(response) }
}

function isRoutineObject(objectType: EditableObjectType): boolean {
  return objectType === 'procedure' || objectType === 'function'
}

async function refreshSchemaTreeAfterSave(tab: ObjectEditorTabState): Promise<void> {
  // refreshCategory no-ops for a category node that was never expanded, so refreshDatabase runs too.
  try {
    await useSchemaStore.getState().refreshCategory(tab.connectionId, tab.database, tab.objectType)
  } catch (error) {
    logFrontend(
      'warn',
      `[object-editor-store] Refreshing the object category after save failed: ${String(error)}`
    )
  }
  try {
    await useSchemaStore.getState().refreshDatabase(tab.connectionId, tab.database)
  } catch (error) {
    logFrontend(
      'warn',
      `[object-editor-store] Refreshing the database after save failed: ${String(error)}`
    )
  }
}

export const useObjectEditorStore = create<ObjectEditorStore>()((set, get) => {
  const patchTab = (tabId: string, partial: Partial<ObjectEditorTabState>) => {
    set((state) => patchObjectEditorTabState(state, { tabId: tabId, partial: partial }))
  }

  return {
    tabs: {},

    initTab: (tabId, meta) => {
      set((state) => initObjectEditorTab(state, { tabId: tabId, meta: meta }))
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
        const body = await getObjectBody({
          connectionId: tab.connectionId,
          database: tab.database,
          objectName: tab.objectName,
          objectType: tab.objectType,
        })

        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          content: body,
          originalContent: body,
          isLoading: false,
          error: null,
        })
      } catch (error) {
        if (!get().tabs[tabId]) return

        const errorMessage = toErrorMessage(error)
        patchTab(tabId, {
          isLoading: false,
          error: errorMessage,
        })
      }
    },

    saveBody: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      patchTab(tabId, { isSaving: true })

      let response: SaveObjectResponse
      try {
        response = await saveObject({
          connectionId: tab.connectionId,
          database: tab.database,
          objectName: tab.objectName,
          objectType: tab.objectType,
          body: tab.content,
          mode: tab.mode,
        })
      } catch (error) {
        if (!get().tabs[tabId]) return

        const errorMessage = toErrorMessage(error)
        showErrorToast('Save failed', errorMessage)
        patchTab(tabId, { isSaving: false, error: errorMessage })
        return
      }

      if (!get().tabs[tabId]) return

      if (!response.success) {
        const errorMessage = response.errorMessage ?? 'Unknown error'
        showErrorToast('Save failed', errorMessage)
        patchTab(tabId, { isSaving: false, error: errorMessage })
        return
      }

      showSuccessToast(`${tab.objectType} saved successfully`)
      patchTab(tabId, savedTabUpdates(tab, response))
      if (isRoutineObject(tab.objectType)) {
        // Signature help must pick up new or changed routines.
        invalidateRoutineCache(tab.connectionId)
        invalidateSchemaMetadataCache(tab.connectionId)
      }
      await refreshSchemaTreeAfterSave(tab)
    },

    cleanupTab: (tabId) => {
      set((state) => removeObjectEditorTab(state, tabId))
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
