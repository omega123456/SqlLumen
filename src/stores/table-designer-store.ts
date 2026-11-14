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

function patchTab(tabId: string, partial: Partial<TableDesignerTabState>) {
  useTableDesignerStore.setState((state) =>
    patchDesignerTab(state, { tabId: tabId, partial: partial })
  )
}

function scheduleRegenerate(tabId: string) {
  clearDebounceTimer(tabId)
  invalidateDdlRequests(tabId)
  debounceTimers[tabId] = setTimeout(() => {
    delete debounceTimers[tabId]
    void useTableDesignerStore.getState().regenerateDdl(tabId)
  }, DDL_REGENERATE_DEBOUNCE_MS)
}

function mutateSchema(tabId: string, buildEdit: (tab: TableDesignerTabState) => SchemaEdit | null) {
  const tab = useTableDesignerStore.getState().tabs[tabId]
  if (!tab) return
  const edit = buildEdit(tab)
  if (!edit) return
  useTableDesignerStore.setState((state) =>
    applyDesignerSchemaEdit(state, { tabId: tabId, edit: edit })
  )
  scheduleRegenerate(tabId)
}

function initTab(tabId: string, target: TableDesignerTarget): void {
  useTableDesignerStore.setState((state) =>
    initDesignerTab(state, { tabId: tabId, target: target })
  )
}

function updateTabContext(
  tabId: string,
  update: { mode: 'create' | 'alter'; objectName: string }
): void {
  patchTab(tabId, {
    mode: update.mode,
    objectName: update.objectName,
  })
}

async function loadSchema(tabId: string): Promise<void> {
  const tab = useTableDesignerStore.getState().tabs[tabId]
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

    if (!useTableDesignerStore.getState().tabs[tabId]) {
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

    await useTableDesignerStore.getState().regenerateDdl(tabId)
  } catch (error) {
    logFrontendError('[table-designer-store] Failed to load table schema', error)

    if (!useTableDesignerStore.getState().tabs[tabId]) {
      return
    }

    patchTab(tabId, {
      loadError: toErrorMessage(error),
      isLoading: false,
    })
  }
}

function updateColumn(tabId: string, edit: DesignerFieldEdit<TableDesignerColumnDef>): void {
  mutateSchema(tabId, (tab) => editColumnField(tab, edit))
}

function addColumn(tabId: string): void {
  mutateSchema(tabId, addBlankColumn)
}

function deleteColumn(tabId: string, columnIndex: number): void {
  mutateSchema(tabId, (tab) => removeColumn(tab, columnIndex))
}

function reorderColumn(tabId: string, fromIndex: number, toIndex: number): void {
  mutateSchema(tabId, (tab) => moveColumn(tab, { fromIndex: fromIndex, toIndex: toIndex }))
}

function updateIndex(tabId: string, edit: DesignerFieldEdit<TableDesignerIndexDef>): void {
  mutateSchema(tabId, (tab) => editIndexField(tab, edit))
}

function addIndex(tabId: string): void {
  mutateSchema(tabId, addBlankIndex)
}

function deleteIndex(tabId: string, indexPosition: number): void {
  mutateSchema(tabId, (tab) => removeIndex(tab, indexPosition))
}

function updateForeignKey(
  tabId: string,
  edit: DesignerFieldEdit<TableDesignerForeignKeyDef>
): void {
  mutateSchema(tabId, (tab) => editForeignKeyField(tab, edit))
}

function addForeignKey(tabId: string): void {
  mutateSchema(tabId, addBlankForeignKey)
}

function deleteForeignKey(tabId: string, foreignKeyIndex: number): void {
  mutateSchema(tabId, (tab) => removeForeignKey(tab, foreignKeyIndex))
}

function updateProperties(
  tabId: string,
  field: keyof TableDesignerProperties,
  value: unknown
): void {
  mutateSchema(tabId, (tab) => editProperty(tab, { field: field, value: value }))
}

function updateTableName(tabId: string, name: string): void {
  mutateSchema(tabId, (tab) => renameTable(tab, name))
}

async function regenerateDdl(tabId: string): Promise<void> {
  clearDebounceTimer(tabId)

  const tab = useTableDesignerStore.getState().tabs[tabId]
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

    if (!useTableDesignerStore.getState().tabs[tabId]) {
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

    if (!useTableDesignerStore.getState().tabs[tabId]) {
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
}

function discardChanges(tabId: string): void {
  useTableDesignerStore.setState((state) => discardDesignerChanges(state, tabId))
  void useTableDesignerStore.getState().regenerateDdl(tabId)
}

function markClean(tabId: string): void {
  patchTab(tabId, {
    isDirty: false,
    validationErrors: {},
  })
}

function requestNavigationAction(tabId: string, callback: () => void): void {
  patchTab(tabId, {
    pendingNavigationAction: callback,
  })
}

function clearNavigationAction(tabId: string): void {
  patchTab(tabId, { pendingNavigationAction: null })
}

function cleanupTab(tabId: string): void {
  clearDebounceTimer(tabId)
  clearDdlRequestVersion(tabId)
  useTableDesignerStore.setState((state) => removeDesignerTab(state, tabId))
}

function setSelectedSubTab(tabId: string, subTab: DesignerSubTab): void {
  patchTab(tabId, {
    selectedSubTab: subTab,
  })
}

export const useTableDesignerStore = create<TableDesignerStore>()(() => ({
  tabs: {},
  initTab: initTab,
  updateTabContext: updateTabContext,
  loadSchema: loadSchema,
  updateColumn: updateColumn,
  addColumn: addColumn,
  deleteColumn: deleteColumn,
  reorderColumn: reorderColumn,
  updateIndex: updateIndex,
  addIndex: addIndex,
  deleteIndex: deleteIndex,
  updateForeignKey: updateForeignKey,
  addForeignKey: addForeignKey,
  deleteForeignKey: deleteForeignKey,
  updateProperties: updateProperties,
  updateTableName: updateTableName,
  regenerateDdl: regenerateDdl,
  discardChanges: discardChanges,
  markClean: markClean,
  requestNavigationAction: requestNavigationAction,
  clearNavigationAction: clearNavigationAction,
  cleanupTab: cleanupTab,
  setSelectedSubTab: setSelectedSubTab,
}))
