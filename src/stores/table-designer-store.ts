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

export interface TableDesignerStore {
  tabs: Record<string, TableDesignerTabState>
  initTab: (
    tabId: string,
    mode: 'create' | 'alter',
    connectionId: string,
    databaseName: string,
    objectName: string
  ) => void
  updateTabContext: (
    tabId: string,
    update: { mode: 'create' | 'alter'; objectName: string }
  ) => void
  loadSchema: (tabId: string) => Promise<void>
  updateColumn: (
    tabId: string,
    colIndex: number,
    field: keyof TableDesignerColumnDef,
    value: unknown
  ) => void
  addColumn: (tabId: string) => void
  deleteColumn: (tabId: string, colIndex: number) => void
  reorderColumn: (tabId: string, fromIndex: number, toIndex: number) => void
  updateIndex: (
    tabId: string,
    idxIndex: number,
    field: keyof TableDesignerIndexDef,
    value: unknown
  ) => void
  addIndex: (tabId: string) => void
  deleteIndex: (tabId: string, idxIndex: number) => void
  updateForeignKey: {
    (tabId: string, fkIndex: number, field: keyof TableDesignerForeignKeyDef, value: unknown): void
    (tabId: string, fkIndex: number, field: string, value: unknown): void
  }
  addForeignKey: (tabId: string) => void
  deleteForeignKey: (tabId: string, fkIndex: number) => void
  updateProperties: (tabId: string, field: keyof TableDesignerProperties, value: unknown) => void
  updateTableName: (tabId: string, name: string) => void
  regenerateDdl: (tabId: string) => Promise<void>
  discardChanges: (tabId: string) => void
  markClean: (tabId: string) => void
  requestNavigationAction: (tabId: string, callback: () => void) => void
  cleanupTab: (tabId: string) => void
  setSelectedSubTab: (tabId: string, subTab: DesignerSubTab) => void
}

function defaultProperties(): TableDesignerProperties {
  return {
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',
    autoIncrement: null,
    rowFormat: 'DEFAULT',
    comment: '',
  }
}

function createBlankSchema(): TableDesignerSchema {
  return {
    tableName: '',
    columns: [],
    indexes: [],
    foreignKeys: [],
    properties: defaultProperties(),
  }
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForComparison(item))
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeForComparison((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }

  return value
}

function schemasEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(normalizeForComparison(a)) === JSON.stringify(normalizeForComparison(b))
}

function validateColumns(columns: TableDesignerColumnDef[]): Record<string, string> {
  const errors: Record<string, string> = {}
  const names = new Set<string>()

  columns.forEach((col, i) => {
    if (!col.name) {
      errors[`columns.${i}.name`] = 'Column name is required'
    } else if (col.name.length > 64) {
      errors[`columns.${i}.name`] = 'Column name must not exceed 64 characters'
    } else if (names.has(col.name.toLowerCase())) {
      errors[`columns.${i}.name`] = 'Duplicate column name'
    } else {
      names.add(col.name.toLowerCase())
    }
  })

  return errors
}

function validateIndexes(indexes: TableDesignerIndexDef[]): Record<string, string> {
  const errors: Record<string, string> = {}
  const names = new Map<string, number[]>()

  indexes.forEach((index, i) => {
    if (index.indexType === 'PRIMARY') {
      return
    }

    const normalizedName = index.name.trim().toLowerCase()
    if (normalizedName !== '') {
      const existing = names.get(normalizedName) ?? []
      existing.push(i)
      names.set(normalizedName, existing)
    }

    if (index.columns.length === 0) {
      errors[`indexes.${i}.columns`] = 'At least one column required'
    }
  })

  names.forEach((indexesForName) => {
    if (indexesForName.length > 1) {
      indexesForName.forEach((indexPosition) => {
        errors[`indexes.${indexPosition}.name`] = 'Duplicate index name'
      })
    }
  })

  return errors
}

function mergeColumnValidationErrors(
  existingErrors: Record<string, string>,
  columns: TableDesignerColumnDef[]
): Record<string, string> {
  const nonColumnErrors = Object.fromEntries(
    Object.entries(existingErrors).filter(([path]) => !path.startsWith('columns.'))
  )

  return {
    ...nonColumnErrors,
    ...validateColumns(columns),
  }
}

function mergeIndexValidationErrors(
  existingErrors: Record<string, string>,
  indexes: TableDesignerIndexDef[]
): Record<string, string> {
  const nonIndexErrors = Object.fromEntries(
    Object.entries(existingErrors).filter(([path]) => !path.startsWith('indexes.'))
  )

  return {
    ...nonIndexErrors,
    ...validateIndexes(indexes),
  }
}

function mergeTableNameValidationError(
  existingErrors: Record<string, string>,
  name: string
): Record<string, string> {
  const nextErrors = Object.fromEntries(
    Object.entries(existingErrors).filter(([path]) => path !== 'tableName')
  )

  if (!name) {
    nextErrors.tableName = 'Table name is required'
  }

  return nextErrors
}

function computeIsDirty(state: TableDesignerTabState): boolean {
  if (state.mode === 'alter') {
    if (!state.originalSchema) return false
    return !schemasEqual(state.currentSchema, state.originalSchema)
  }

  const schema = state.currentSchema
  return (
    schema.columns.length > 0 ||
    schema.indexes.length > 0 ||
    schema.foreignKeys.length > 0 ||
    schema.tableName !== '' ||
    !schemasEqual(schema.properties, defaultProperties())
  )
}

function createDefaultTabState(
  mode: 'create' | 'alter',
  connectionId: string,
  databaseName: string,
  objectName: string
): TableDesignerTabState {
  return {
    connectionId,
    databaseName,
    objectName,
    mode,
    originalSchema: null,
    currentSchema: createBlankSchema(),
    isDirty: false,
    isLoading: false,
    loadError: null,
    ddl: '',
    ddlWarnings: [],
    isDdlLoading: false,
    ddlError: null,
    validationErrors: {},
    pendingNavigationAction: null,
    selectedSubTab: 'columns',
  }
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

function isCreateDraftReadyForDdl(tab: TableDesignerTabState): boolean {
  return !(
    tab.mode === 'create' &&
    (tab.currentSchema.tableName.trim() === '' || Object.keys(tab.validationErrors).length > 0)
  )
}

export const useTableDesignerStore = create<TableDesignerStore>()((set, get) => {
  const patchTab = (tabId: string, partial: Partial<TableDesignerTabState>) => {
    set((state) => {
      const existing = state.tabs[tabId]
      if (!existing) {
        return state
      }

      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...existing, ...partial },
        },
      }
    })
  }

  const scheduleRegenerate = (tabId: string) => {
    clearDebounceTimer(tabId)
    invalidateDdlRequests(tabId)
    debounceTimers[tabId] = setTimeout(() => {
      delete debounceTimers[tabId]
      void get().regenerateDdl(tabId)
    }, 300)
  }

  const mutateSchema = (
    tabId: string,
    mutate: (tab: TableDesignerTabState) => {
      schema: TableDesignerSchema
      validationErrors?: Record<string, string>
    } | null
  ) => {
    let changed = false

    set((state) => {
      const existing = state.tabs[tabId]
      if (!existing) {
        return state
      }

      const result = mutate(existing)
      if (!result) {
        return state
      }

      changed = true

      const nextTab: TableDesignerTabState = {
        ...existing,
        currentSchema: result.schema,
        validationErrors: result.validationErrors ?? existing.validationErrors,
      }
      nextTab.isDirty = computeIsDirty(nextTab)

      return {
        tabs: {
          ...state.tabs,
          [tabId]: nextTab,
        },
      }
    })

    if (changed) {
      scheduleRegenerate(tabId)
    }
  }

  return {
    tabs: {},

    initTab: (tabId, mode, connectionId, databaseName, objectName) => {
      set((state) => {
        if (state.tabs[tabId]) {
          return state
        }

        return {
          tabs: {
            ...state.tabs,
            [tabId]: createDefaultTabState(mode, connectionId, databaseName, objectName),
          },
        }
      })
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
        const loadedSchema = await loadTableForDesigner(
          tab.connectionId,
          tab.databaseName,
          tab.objectName
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
        console.error('[table-designer-store] Failed to load table schema', error)

        if (!get().tabs[tabId]) {
          return
        }

        patchTab(tabId, {
          loadError: error instanceof Error ? error.message : String(error),
          isLoading: false,
        })
      }
    },

    updateColumn: (tabId, colIndex, field, value) => {
      mutateSchema(tabId, (tab) => {
        if (colIndex < 0 || colIndex >= tab.currentSchema.columns.length) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        const column = schema.columns[colIndex]
        const oldName = column.name

        ;(column[field] as unknown) = value

        if (field === 'name') {
          const nextName = typeof value === 'string' ? value : String(value ?? '')
          column.name = nextName
          schema.indexes = schema.indexes.map((index) => ({
            ...index,
            columns: index.columns.map((name) => (name === oldName ? nextName : name)),
          }))
          schema.foreignKeys = schema.foreignKeys.map((foreignKey) => ({
            ...foreignKey,
            sourceColumn: foreignKey.sourceColumn === oldName ? nextName : foreignKey.sourceColumn,
          }))
        }

        return {
          schema,
          validationErrors: mergeIndexValidationErrors(
            mergeColumnValidationErrors(tab.validationErrors, schema.columns),
            schema.indexes
          ),
        }
      })
    },

    addColumn: (tabId) => {
      mutateSchema(tabId, (tab) => {
        const schema = cloneValue(tab.currentSchema)
        schema.columns.push({
          name: '',
          type: 'VARCHAR',
          length: '255',
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          defaultValue: { tag: 'NO_DEFAULT' },
          comment: '',
          originalName: '',
        })

        return {
          schema,
          validationErrors: mergeIndexValidationErrors(
            mergeColumnValidationErrors(tab.validationErrors, schema.columns),
            schema.indexes
          ),
        }
      })
    },

    deleteColumn: (tabId, colIndex) => {
      mutateSchema(tabId, (tab) => {
        if (colIndex < 0 || colIndex >= tab.currentSchema.columns.length) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        const [removedColumn] = schema.columns.splice(colIndex, 1)
        if (!removedColumn) {
          return null
        }

        schema.indexes = schema.indexes
          .map((index) => ({
            ...index,
            columns: index.columns.filter((name) => name !== removedColumn.name),
          }))
          .filter((index) => index.columns.length > 0)

        schema.foreignKeys = schema.foreignKeys.filter(
          (foreignKey) => foreignKey.sourceColumn !== removedColumn.name
        )

        return {
          schema,
          validationErrors: mergeIndexValidationErrors(
            mergeColumnValidationErrors(tab.validationErrors, schema.columns),
            schema.indexes
          ),
        }
      })
    },

    reorderColumn: (tabId, fromIndex, toIndex) => {
      mutateSchema(tabId, (tab) => {
        const columns = tab.currentSchema.columns
        if (
          fromIndex < 0 ||
          fromIndex >= columns.length ||
          toIndex < 0 ||
          toIndex >= columns.length ||
          fromIndex === toIndex
        ) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        const [moved] = schema.columns.splice(fromIndex, 1)
        if (!moved) {
          return null
        }

        schema.columns.splice(toIndex, 0, moved)

        return {
          schema,
          validationErrors: mergeIndexValidationErrors(
            mergeColumnValidationErrors(tab.validationErrors, schema.columns),
            schema.indexes
          ),
        }
      })
    },

    updateIndex: (tabId, idxIndex, field, value) => {
      mutateSchema(tabId, (tab) => {
        if (idxIndex < 0 || idxIndex >= tab.currentSchema.indexes.length) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        ;(schema.indexes[idxIndex][field] as unknown) = value

        return {
          schema,
          validationErrors: mergeIndexValidationErrors(tab.validationErrors, schema.indexes),
        }
      })
    },

    addIndex: (tabId) => {
      mutateSchema(tabId, (tab) => {
        const schema = cloneValue(tab.currentSchema)
        schema.indexes.push({
          name: '',
          indexType: 'INDEX',
          columns: [],
        })

        return {
          schema,
          validationErrors: mergeIndexValidationErrors(tab.validationErrors, schema.indexes),
        }
      })
    },

    deleteIndex: (tabId, idxIndex) => {
      mutateSchema(tabId, (tab) => {
        if (idxIndex < 0 || idxIndex >= tab.currentSchema.indexes.length) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        schema.indexes.splice(idxIndex, 1)

        return {
          schema,
          validationErrors: mergeIndexValidationErrors(tab.validationErrors, schema.indexes),
        }
      })
    },

    updateForeignKey: (tabId, fkIndex, field, value) => {
      mutateSchema(tabId, (tab) => {
        if (fkIndex < 0 || fkIndex >= tab.currentSchema.foreignKeys.length) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        ;(schema.foreignKeys[fkIndex] as unknown as Record<string, unknown>)[field] = value

        return { schema }
      })
    },

    addForeignKey: (tabId) => {
      mutateSchema(tabId, (tab) => {
        const schema = cloneValue(tab.currentSchema)
        schema.foreignKeys.push({
          name: '',
          sourceColumn: '',
          referencedTable: '',
          referencedColumn: '',
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
          isComposite: false,
        })

        return { schema }
      })
    },

    deleteForeignKey: (tabId, fkIndex) => {
      mutateSchema(tabId, (tab) => {
        if (fkIndex < 0 || fkIndex >= tab.currentSchema.foreignKeys.length) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        schema.foreignKeys.splice(fkIndex, 1)

        return { schema }
      })
    },

    updateProperties: (tabId, field, value) => {
      mutateSchema(tabId, (tab) => {
        const schema = cloneValue(tab.currentSchema)
        ;(schema.properties[field] as unknown) = value

        return { schema }
      })
    },

    updateTableName: (tabId, name) => {
      mutateSchema(tabId, (tab) => {
        const schema = cloneValue(tab.currentSchema)
        schema.tableName = name

        return {
          schema,
          validationErrors: mergeTableNameValidationError(tab.validationErrors, name),
        }
      })
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
        console.error('[table-designer-store] Failed to regenerate DDL', error)

        if (!get().tabs[tabId]) {
          return
        }

        if (ddlRequestVersions[tabId] !== requestVersion) {
          return
        }

        patchTab(tabId, {
          ddl: '',
          ddlWarnings: [],
          ddlError: error instanceof Error ? error.message : String(error),
          isDdlLoading: false,
        })
      }
    },

    discardChanges: (tabId) => {
      set((state) => {
        const existing = state.tabs[tabId]
        if (!existing) {
          return state
        }

        const currentSchema =
          existing.mode === 'alter'
            ? existing.originalSchema
              ? cloneValue(existing.originalSchema)
              : cloneValue(existing.currentSchema)
            : createBlankSchema()

        const nextTab: TableDesignerTabState = {
          ...existing,
          currentSchema,
          validationErrors: {},
          ddl: '',
          ddlError: null,
          ddlWarnings: [],
          isDdlLoading: true,
        }
        nextTab.isDirty = computeIsDirty(nextTab)

        return {
          tabs: {
            ...state.tabs,
            [tabId]: nextTab,
          },
        }
      })

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

    cleanupTab: (tabId) => {
      clearDebounceTimer(tabId)
      clearDdlRequestVersion(tabId)

      set((state) => {
        if (!state.tabs[tabId]) {
          return state
        }

        const nextTabs = { ...state.tabs }
        delete nextTabs[tabId]
        return { tabs: nextTabs }
      })
    },

    setSelectedSubTab: (tabId, subTab) => {
      patchTab(tabId, {
        selectedSubTab: subTab,
      })
    },
  }
})
