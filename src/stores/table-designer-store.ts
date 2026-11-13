import { create } from 'zustand'
import { generateTableDdl, loadTableForDesigner } from '../lib/table-designer-commands'
import {
  clampLengthForType,
  getDefaultLengthForType,
  normalizeTypeModifier,
} from '../components/table-designer/table-designer-type-constants'
import type {
  DesignerSubTab,
  TableDesignerColumnDef,
  TableDesignerForeignKeyDef,
  TableDesignerIndexDef,
  TableDesignerProperties,
  TableDesignerSchema,
} from '../types/schema'

import { logFrontendError } from '../lib/app-log-commands'
import { MYSQL_IDENTIFIER_MAX_LENGTH } from '../lib/sql-utils'
import { toErrorMessage } from '../lib/error-message'
import { isIndexInBounds, isNonEmptyList, isObjectRecord } from '../lib/value-checks'

const DDL_REGENERATE_DEBOUNCE_MS = 300
const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const ddlRequestVersions: Record<string, number> = {}
const INTEGER_TYPES_WITH_DEFAULT_DISPLAY_LENGTH = new Set([
  'INT',
  'TINYINT',
  'SMALLINT',
  'MEDIUMINT',
  'BIGINT',
])

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
    columnIndex: number,
    field: keyof TableDesignerColumnDef,
    value: unknown
  ) => void
  addColumn: (tabId: string) => void
  deleteColumn: (tabId: string, columnIndex: number) => void
  reorderColumn: (tabId: string, fromIndex: number, toIndex: number) => void
  updateIndex: (
    tabId: string,
    indexPosition: number,
    field: keyof TableDesignerIndexDef,
    value: unknown
  ) => void
  addIndex: (tabId: string) => void
  deleteIndex: (tabId: string, indexPosition: number) => void
  updateForeignKey: {
    (
      tabId: string,
      foreignKeyIndex: number,
      field: keyof TableDesignerForeignKeyDef,
      value: unknown
    ): void
    (tabId: string, foreignKeyIndex: number, field: string, value: unknown): void
  }
  addForeignKey: (tabId: string) => void
  deleteForeignKey: (tabId: string, foreignKeyIndex: number) => void
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

  if (isObjectRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = normalizeForComparison(value[key])
        return accumulator
      }, {})
  }

  return value
}

function schemasEqual<T>(left: T, right: T): boolean {
  return (
    JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right))
  )
}

function canonicalizeColumn(column: TableDesignerColumnDef): TableDesignerColumnDef {
  const normalizedModifier = normalizeTypeModifier(column.type, column.typeModifier)
  if (normalizedModifier === '') {
    const { typeModifier, ...rest } = column
    void typeModifier
    return rest
  }

  return {
    ...column,
    typeModifier: normalizedModifier,
  }
}

function canonicalizeSchema(schema: TableDesignerSchema): TableDesignerSchema {
  return {
    ...schema,
    columns: schema.columns.map(canonicalizeColumn),
  }
}

function normalizeLoadedColumn(column: TableDesignerColumnDef): TableDesignerColumnDef {
  const hasLength = column.length.trim() !== ''
  if (hasLength) {
    return column
  }

  const normalizedType = column.type.trim().toUpperCase()
  if (!INTEGER_TYPES_WITH_DEFAULT_DISPLAY_LENGTH.has(normalizedType)) {
    return column
  }

  return {
    ...column,
    length: getDefaultLengthForType(normalizedType),
  }
}

function normalizeLoadedSchema(schema: TableDesignerSchema): TableDesignerSchema {
  return {
    ...schema,
    columns: schema.columns.map(normalizeLoadedColumn),
  }
}

function columnNameError(name: string, seenNames: Set<string>): string | null {
  if (!name) return 'Column name is required'
  if (name.length > MYSQL_IDENTIFIER_MAX_LENGTH) {
    return `Column name must not exceed ${MYSQL_IDENTIFIER_MAX_LENGTH} characters`
  }
  if (seenNames.has(name.toLowerCase())) return 'Duplicate column name'
  return null
}

const AUTO_INCREMENT_CAPABLE_TYPE =
  /^(INT|TINYINT|SMALLINT|MEDIUMINT|BIGINT|DECIMAL|FLOAT|DOUBLE|BIT|BOOLEAN)$/i

interface PreviousColumnIdentity {
  type: string
  name: string
}

interface ColumnFieldChange {
  schema: TableDesignerSchema
  column: TableDesignerColumnDef
  previous: PreviousColumnIdentity
  text: string
}

function fieldValueAsText(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function canKeepAutoIncrement(column: TableDesignerColumnDef): boolean {
  if (!column.isPrimaryKey) return false
  return AUTO_INCREMENT_CAPABLE_TYPE.test(column.type.trim())
}

function applyColumnTypeChange({ column, previous, text }: ColumnFieldChange): void {
  column.type = text
  column.length =
    text === previous.type ? clampLengthForType(text, column.length) : getDefaultLengthForType(text)
  column.typeModifier = normalizeTypeModifier(text, column.typeModifier)
  const mustDropAutoIncrement = column.isAutoIncrement && !canKeepAutoIncrement(column)
  if (mustDropAutoIncrement) {
    column.isAutoIncrement = false
  }
}

function applyColumnLengthChange({ column, text }: ColumnFieldChange): void {
  column.length = clampLengthForType(column.type, text)
}

function applyColumnTypeModifierChange({ column, text }: ColumnFieldChange): void {
  column.typeModifier = normalizeTypeModifier(column.type, text)
}

function applyColumnRename({ schema, column, previous, text }: ColumnFieldChange): void {
  const renameColumn = (name: string) => (name === previous.name ? text : name)
  column.name = text
  schema.indexes = schema.indexes.map((index) => ({
    ...index,
    columns: index.columns.map(renameColumn),
  }))
  schema.foreignKeys = schema.foreignKeys.map((foreignKey) => ({
    ...foreignKey,
    sourceColumn: renameColumn(foreignKey.sourceColumn),
  }))
}

const COLUMN_FIELD_NORMALIZERS: Partial<
  Record<keyof TableDesignerColumnDef, (change: ColumnFieldChange) => void>
> = {
  type: applyColumnTypeChange,
  length: applyColumnLengthChange,
  typeModifier: applyColumnTypeModifierChange,
  name: applyColumnRename,
}

function resetSchemaFor(tab: TableDesignerTabState): TableDesignerSchema {
  if (tab.mode !== 'alter') return createBlankSchema()
  return cloneValue(tab.originalSchema ?? tab.currentSchema)
}

function validateColumns(columns: TableDesignerColumnDef[]): Record<string, string> {
  const errors: Record<string, string> = {}
  const names = new Set<string>()

  columns.forEach((column, columnIndex) => {
    const nameError = columnNameError(column.name, names)
    if (nameError) {
      errors[`columns.${columnIndex}.name`] = nameError
      return
    }
    names.add(column.name.toLowerCase())
  })

  return errors
}

function validateIndexes(indexes: TableDesignerIndexDef[]): Record<string, string> {
  const errors: Record<string, string> = {}
  const names = new Map<string, number[]>()

  indexes.forEach((index, position) => {
    if (index.indexType === 'PRIMARY') {
      return
    }

    const normalizedName = index.name.trim().toLowerCase()
    if (normalizedName !== '') {
      const existing = names.get(normalizedName) ?? []
      existing.push(position)
      names.set(normalizedName, existing)
    }

    const hasNoColumns = index.columns.length === 0
    if (hasNoColumns) {
      errors[`indexes.${position}.columns`] = 'At least one column required'
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
    return !schemasEqual(
      canonicalizeSchema(state.currentSchema),
      canonicalizeSchema(state.originalSchema)
    )
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
    connectionId: connectionId,
    databaseName: databaseName,
    objectName: objectName,
    mode: mode,
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
    }, DDL_REGENERATE_DEBOUNCE_MS)
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

    updateColumn: (tabId, columnIndex, field, value) => {
      mutateSchema(tabId, (tab) => {
        if (!isIndexInBounds(columnIndex, tab.currentSchema.columns.length)) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        const column = schema.columns[columnIndex]
        const previous: PreviousColumnIdentity = { type: column.type, name: column.name }

        ;(column[field] as unknown) = value

        COLUMN_FIELD_NORMALIZERS[field]?.({
          schema: schema,
          column: column,
          previous: previous,
          text: fieldValueAsText(value),
        })

        return {
          schema: schema,
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
          length: getDefaultLengthForType('VARCHAR'),
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          defaultValue: { tag: 'NO_DEFAULT' },
          comment: '',
          originalName: '',
        })

        return {
          schema: schema,
          validationErrors: mergeIndexValidationErrors(
            mergeColumnValidationErrors(tab.validationErrors, schema.columns),
            schema.indexes
          ),
        }
      })
    },

    deleteColumn: (tabId, columnIndex) => {
      mutateSchema(tabId, (tab) => {
        if (!isIndexInBounds(columnIndex, tab.currentSchema.columns.length)) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        const [removedColumn] = schema.columns.splice(columnIndex, 1)
        if (!removedColumn) {
          return null
        }

        schema.indexes = schema.indexes
          .map((index) => ({
            ...index,
            columns: index.columns.filter((name) => name !== removedColumn.name),
          }))
          .filter((index) => isNonEmptyList(index.columns))

        schema.foreignKeys = schema.foreignKeys.filter(
          (foreignKey) => foreignKey.sourceColumn !== removedColumn.name
        )

        return {
          schema: schema,
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
        const isValidMove =
          isIndexInBounds(fromIndex, columns.length) &&
          isIndexInBounds(toIndex, columns.length) &&
          fromIndex !== toIndex
        if (!isValidMove) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        const [moved] = schema.columns.splice(fromIndex, 1)
        if (!moved) {
          return null
        }

        schema.columns.splice(toIndex, 0, moved)

        return {
          schema: schema,
          validationErrors: mergeIndexValidationErrors(
            mergeColumnValidationErrors(tab.validationErrors, schema.columns),
            schema.indexes
          ),
        }
      })
    },

    updateIndex: (tabId, indexPosition, field, value) => {
      mutateSchema(tabId, (tab) => {
        if (!isIndexInBounds(indexPosition, tab.currentSchema.indexes.length)) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        ;(schema.indexes[indexPosition][field] as unknown) = value

        return {
          schema: schema,
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
          schema: schema,
          validationErrors: mergeIndexValidationErrors(tab.validationErrors, schema.indexes),
        }
      })
    },

    deleteIndex: (tabId, indexPosition) => {
      mutateSchema(tabId, (tab) => {
        if (!isIndexInBounds(indexPosition, tab.currentSchema.indexes.length)) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        schema.indexes.splice(indexPosition, 1)

        return {
          schema: schema,
          validationErrors: mergeIndexValidationErrors(tab.validationErrors, schema.indexes),
        }
      })
    },

    updateForeignKey: (tabId, foreignKeyIndex, field, value) => {
      mutateSchema(tabId, (tab) => {
        if (!isIndexInBounds(foreignKeyIndex, tab.currentSchema.foreignKeys.length)) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        ;(schema.foreignKeys[foreignKeyIndex] as unknown as Record<string, unknown>)[field] = value

        return { schema }
      })
    },

    addForeignKey: (tabId) => {
      mutateSchema(tabId, (tab) => {
        const schema = cloneValue(tab.currentSchema)
        schema.foreignKeys.push({
          name: '',
          sourceColumn: '',
          referencedDatabase: tab.databaseName,
          referencedTable: '',
          referencedColumn: '',
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
          isComposite: false,
        })

        return { schema }
      })
    },

    deleteForeignKey: (tabId, foreignKeyIndex) => {
      mutateSchema(tabId, (tab) => {
        if (!isIndexInBounds(foreignKeyIndex, tab.currentSchema.foreignKeys.length)) {
          return null
        }

        const schema = cloneValue(tab.currentSchema)
        schema.foreignKeys.splice(foreignKeyIndex, 1)

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
          schema: schema,
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
      set((state) => {
        const existing = state.tabs[tabId]
        if (!existing) {
          return state
        }

        const currentSchema = resetSchemaFor(existing)

        const nextTab: TableDesignerTabState = {
          ...existing,
          currentSchema: currentSchema,
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
