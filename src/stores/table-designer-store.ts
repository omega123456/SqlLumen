import { create } from 'zustand'
import { generateTableDdl, loadTableForDesigner } from '../lib/table-designer-commands'
import type {
  DesignerSubTab,
  TableDesignerColumnDef,
  TableDesignerForeignKeyDef,
  TableDesignerIndexDef,
  TableDesignerProperties,
  TableDesignerSchema,
} from '../types/schema'

import { logFrontendError } from '../lib/app-log-commands'
import { toErrorMessage } from '../lib/error-message'
import {
  cloneValue,
  isCreateDraftReadyForDdl,
  normalizeLoadedSchema,
} from './table-designer-store/designer-schema'
import {
  addBlankColumn,
  addBlankForeignKey,
  addBlankIndex,
  editColumnField,
  editForeignKeyField,
  editIndexField,
  editProperty,
  moveColumn,
  removeColumn,
  removeForeignKey,
  removeIndex,
  renameTable,
  type SchemaEdit,
} from './table-designer-store/schema-edits'
import {
  applyDesignerSchemaEdit,
  discardDesignerChanges,
  initDesignerTab,
  patchDesignerTab,
  removeDesignerTab,
} from './table-designer-store/designer-tab-reducers'

const DDL_REGENERATE_DEBOUNCE_MS = 300
const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const ddlRequestVersions: Record<string, number> = {}

export interface TableDesignerTabState {
  connectionId: string
  databaseName: string
  objectName: string
  mode: 'create' | 'alter'
  originalSchema: TableDesignerSchema | null
  currentSchema: TableDesignerSchema
  isDirty: boolean
  isLoading: boolean
  loadError: string | null
  ddl: string
  ddlWarnings: string[]
  isDdlLoading: boolean
  ddlError: string | null
  validationErrors: Record<string, string>
  pendingNavigationAction: (() => void) | null
  selectedSubTab: DesignerSubTab
}

export interface TableDesignerTarget {
  mode: 'create' | 'alter'
  connectionId: string
  databaseName: string
  objectName: string
}

export interface DesignerFieldEdit<TRow> {
  index: number
  field: keyof TRow
  value: unknown
}

export interface TableDesignerStore {
  tabs: Record<string, TableDesignerTabState>
  initTab: (tabId: string, target: TableDesignerTarget) => void
  updateTabContext: (
    tabId: string,
    update: { mode: 'create' | 'alter'; objectName: string }
  ) => void
  loadSchema: (tabId: string) => Promise<void>
  updateColumn: (tabId: string, edit: DesignerFieldEdit<TableDesignerColumnDef>) => void
  addColumn: (tabId: string) => void
  deleteColumn: (tabId: string, columnIndex: number) => void
  reorderColumn: (tabId: string, fromIndex: number, toIndex: number) => void
  updateIndex: (tabId: string, edit: DesignerFieldEdit<TableDesignerIndexDef>) => void
  addIndex: (tabId: string) => void
  deleteIndex: (tabId: string, indexPosition: number) => void
  updateForeignKey: (tabId: string, edit: DesignerFieldEdit<TableDesignerForeignKeyDef>) => void
  addForeignKey: (tabId: string) => void
  deleteForeignKey: (tabId: string, foreignKeyIndex: number) => void
  updateProperties: (tabId: string, field: keyof TableDesignerProperties, value: unknown) => void
  updateTableName: (tabId: string, name: string) => void
  regenerateDdl: (tabId: string) => Promise<void>
  discardChanges: (tabId: string) => void
  markClean: (tabId: string) => void
  requestNavigationAction: (tabId: string, callback: () => void) => void
  clearNavigationAction: (tabId: string) => void
  cleanupTab: (tabId: string) => void
  setSelectedSubTab: (tabId: string, subTab: DesignerSubTab) => void
}

function clearDebounceTimer(tabId: string): void {
  if (debounceTimers[tabId]) {
    clearTimeout(debounceTimers[tabId])
    delete debounceTimers[tabId]
  }
}

function clearDdlRequestVersion(tabId: string): void {
  delete ddlRequestVersions[tabId]
}

function nextDdlRequestVersion(tabId: string): number {
  const nextVersion = (ddlRequestVersions[tabId] ?? 0) + 1
  ddlRequestVersions[tabId] = nextVersion
  return nextVersion
}

function invalidateDdlRequests(tabId: string): void {
  nextDdlRequestVersion(tabId)
}

export const useTableDesignerStore = create<TableDesignerStore>()((set, get) => {
  const patchTab = (tabId: string, partial: Partial<TableDesignerTabState>) => {
    set((state) => patchDesignerTab(state, { tabId: tabId, partial: partial }))
  }

  const scheduleRegenerate = (tabId: string) => {
    clearDebounceTimer(tabId)
    invalidateDdlRequests(tabId)
    debounceTimers[tabId] = setTimeout(() => {
      delete debounceTimers[tabId]
      void get().regenerateDdl(tabId)
    }, DDL_REGENERATE_DEBOUNCE_MS)
  }

  const mutateSchema = (
    tabId: string,
    buildEdit: (tab: TableDesignerTabState) => SchemaEdit | null
  ) => {
    const tab = get().tabs[tabId]
    if (!tab) return
    const edit = buildEdit(tab)
    if (!edit) return
    set((state) => applyDesignerSchemaEdit(state, { tabId: tabId, edit: edit }))
    scheduleRegenerate(tabId)
  }

  return {
    tabs: {},

    initTab: (tabId, target) => {
      set((state) => initDesignerTab(state, { tabId: tabId, target: target }))
    },
    updateTabContext: (tabId, update) => {
      patchTab(tabId, {
        mode: update.mode,
        objectName: update.objectName,
      })
    },

    loadSchema: async (tabId) => {
      const tab = get().tabs[tabId]
      if (!tab) {
        return
      }

      if (tab.mode === 'create') {
        patchTab(tabId, { isLoading: false, loadError: null })
        return
      }

      patchTab(tabId, { isLoading: true, loadError: null })

      try {
        const loadedSchema = normalizeLoadedSchema(
          await loadTableForDesigner(tab.connectionId, tab.databaseName, tab.objectName)
        )

        if (!get().tabs[tabId]) {
          return
        }

        patchTab(tabId, {
          originalSchema: cloneValue(loadedSchema),
          currentSchema: cloneValue(loadedSchema),
          isDirty: false,
          isLoading: false,
          loadError: null,
          validationErrors: {},
        })

        await get().regenerateDdl(tabId)
      } catch (error) {
        logFrontendError('[table-designer-store] Failed to load table schema', error)

        if (!get().tabs[tabId]) {
          return
        }

        patchTab(tabId, {
          loadError: toErrorMessage(error),
          isLoading: false,
        })
      }
    },

    updateColumn: (tabId, edit) => {
      mutateSchema(tabId, (tab) => editColumnField(tab, edit))
    },

    addColumn: (tabId) => {
      mutateSchema(tabId, addBlankColumn)
    },

    deleteColumn: (tabId, columnIndex) => {
      mutateSchema(tabId, (tab) => removeColumn(tab, columnIndex))
    },

    reorderColumn: (tabId, fromIndex, toIndex) => {
      mutateSchema(tabId, (tab) => moveColumn(tab, { fromIndex: fromIndex, toIndex: toIndex }))
    },

    updateIndex: (tabId, edit) => {
      mutateSchema(tabId, (tab) => editIndexField(tab, edit))
    },

    addIndex: (tabId) => {
      mutateSchema(tabId, addBlankIndex)
    },

    deleteIndex: (tabId, indexPosition) => {
      mutateSchema(tabId, (tab) => removeIndex(tab, indexPosition))
    },

    updateForeignKey: (tabId, edit) => {
      mutateSchema(tabId, (tab) => editForeignKeyField(tab, edit))
    },

    addForeignKey: (tabId) => {
      mutateSchema(tabId, addBlankForeignKey)
    },

    deleteForeignKey: (tabId, foreignKeyIndex) => {
      mutateSchema(tabId, (tab) => removeForeignKey(tab, foreignKeyIndex))
    },

    updateProperties: (tabId, field, value) => {
      mutateSchema(tabId, (tab) => editProperty(tab, { field: field, value: value }))
    },

    updateTableName: (tabId, name) => {
      mutateSchema(tabId, (tab) => renameTable(tab, name))
    },

    regenerateDdl: async (tabId) => {
      clearDebounceTimer(tabId)

      const tab = get().tabs[tabId]
      if (!tab) {
        return
      }

      const requestVersion = nextDdlRequestVersion(tabId)

      if (!isCreateDraftReadyForDdl(tab)) {
        patchTab(tabId, {
          ddl: '',
          ddlWarnings: [],
          ddlError: null,
          isDdlLoading: false,
        })
        return
      }

      patchTab(tabId, {
        isDdlLoading: true,
      })

      try {
        const response = await generateTableDdl({
          originalSchema: tab.originalSchema ? cloneValue(tab.originalSchema) : null,
          currentSchema: cloneValue(tab.currentSchema),
          database: tab.databaseName,
          mode: tab.mode,
        })

        if (!get().tabs[tabId]) {
          return
        }

        if (ddlRequestVersions[tabId] !== requestVersion) {
          return
        }

        patchTab(tabId, {
          ddl: response.ddl,
          ddlWarnings: response.warnings,
          ddlError: null,
          isDdlLoading: false,
        })
      } catch (error) {
        logFrontendError('[table-designer-store] Failed to regenerate DDL', error)

        if (!get().tabs[tabId]) {
          return
        }

        if (ddlRequestVersions[tabId] !== requestVersion) {
          return
        }

        patchTab(tabId, {
          ddl: '',
          ddlWarnings: [],
          ddlError: toErrorMessage(error),
          isDdlLoading: false,
        })
      }
    },

    discardChanges: (tabId) => {
      set((state) => discardDesignerChanges(state, tabId))
      void get().regenerateDdl(tabId)
    },

    markClean: (tabId) => {
      patchTab(tabId, {
        isDirty: false,
        validationErrors: {},
      })
    },

    requestNavigationAction: (tabId, callback) => {
      patchTab(tabId, {
        pendingNavigationAction: callback,
      })
    },

    clearNavigationAction: (tabId) => {
      patchTab(tabId, { pendingNavigationAction: null })
    },

    cleanupTab: (tabId) => {
      clearDebounceTimer(tabId)
      clearDdlRequestVersion(tabId)
      set((state) => removeDesignerTab(state, tabId))
    },

    setSelectedSubTab: (tabId, subTab) => {
      patchTab(tabId, {
        selectedSubTab: subTab,
      })
    },
  }
})
