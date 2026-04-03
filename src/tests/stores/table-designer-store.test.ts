import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import type { TableDesignerSchema } from '../../types/schema'

const invokeMock = vi.mocked(invoke)

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function defaultProperties() {
  return {
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',
    autoIncrement: null,
    rowFormat: 'DEFAULT',
    comment: '',
  }
}

const loadedSchema: TableDesignerSchema = {
  tableName: 'users',
  columns: [
    {
      name: 'id',
      type: 'INT',
      length: '11',
      nullable: false,
      isPrimaryKey: true,
      isAutoIncrement: true,
      defaultValue: { tag: 'NO_DEFAULT' },
      comment: '',
      originalName: 'id',
    },
    {
      name: 'email',
      type: 'VARCHAR',
      length: '255',
      nullable: false,
      isPrimaryKey: false,
      isAutoIncrement: false,
      defaultValue: { tag: 'NO_DEFAULT' },
      comment: '',
      originalName: 'email',
    },
    {
      name: 'role_id',
      type: 'INT',
      length: '11',
      nullable: true,
      isPrimaryKey: false,
      isAutoIncrement: false,
      defaultValue: { tag: 'NULL_DEFAULT' },
      comment: '',
      originalName: 'role_id',
    },
  ],
  indexes: [
    { name: 'PRIMARY', indexType: 'PRIMARY', columns: ['id'] },
    { name: 'idx_email', indexType: 'UNIQUE', columns: ['email'] },
    { name: 'idx_role_id', indexType: 'INDEX', columns: ['role_id'] },
  ],
  foreignKeys: [
    {
      name: 'fk_users_role',
      sourceColumn: 'role_id',
      referencedTable: 'roles',
      referencedColumn: 'id',
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
      isComposite: false,
    },
  ],
  properties: defaultProperties(),
}

function getGenerateDdlCalls() {
  return invokeMock.mock.calls.filter(([command]) => command === 'generate_table_ddl')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function initCreateTab(tabId = 'tab-1') {
  useTableDesignerStore.getState().initTab(tabId, 'create', 'conn-1', 'app_db', '__new_table__')
}

function initAlterTab(tabId = 'tab-1') {
  useTableDesignerStore.getState().initTab(tabId, 'alter', 'conn-1', 'app_db', 'users')
}

function seedAlterTab(tabId = 'tab-1') {
  initAlterTab(tabId)
  useTableDesignerStore.setState((state) => ({
    tabs: {
      ...state.tabs,
      [tabId]: {
        ...state.tabs[tabId],
        originalSchema: clone(loadedSchema),
        currentSchema: clone(loadedSchema),
        isDirty: false,
      },
    },
  }))
}

beforeEach(() => {
  vi.useFakeTimers()

  Object.keys(useTableDesignerStore.getState().tabs).forEach((tabId) => {
    useTableDesignerStore.getState().cleanupTab(tabId)
  })

  for (const tabId of ['tab-1', 'tab-2', 'debounce-tab', 'load-tab']) {
    useTableDesignerStore.getState().cleanupTab(tabId)
  }

  useTableDesignerStore.setState({ tabs: {} })

  invokeMock.mockReset()
  invokeMock.mockImplementation(async (command) => {
    if (command === 'load_table_for_designer') {
      return clone(loadedSchema)
    }

    if (command === 'generate_table_ddl') {
      return { ddl: 'CREATE TABLE users (...);', warnings: [] }
    }

    throw new Error(`Unexpected IPC command: ${String(command)}`)
  })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useTableDesignerStore — initTab', () => {
  it('initTab creates tab state with correct initial values in alter mode', () => {
    initAlterTab()

    const tab = useTableDesignerStore.getState().tabs['tab-1']
    expect(tab.connectionId).toBe('conn-1')
    expect(tab.databaseName).toBe('app_db')
    expect(tab.objectName).toBe('users')
    expect(tab.mode).toBe('alter')
    expect(tab.originalSchema).toBeNull()
    expect(tab.currentSchema).toEqual({
      tableName: '',
      columns: [],
      indexes: [],
      foreignKeys: [],
      properties: defaultProperties(),
    })
    expect(tab.isDirty).toBe(false)
    expect(tab.selectedSubTab).toBe('columns')
  })

  it('initTab creates tab state with empty schema in create mode', () => {
    initCreateTab()

    expect(useTableDesignerStore.getState().tabs['tab-1'].currentSchema).toEqual({
      tableName: '',
      columns: [],
      indexes: [],
      foreignKeys: [],
      properties: defaultProperties(),
    })
  })

  it('initTab is idempotent — does not overwrite existing tab state', () => {
    initCreateTab()
    useTableDesignerStore.getState().addColumn('tab-1')

    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-2', 'other_db', 'other_table')

    const tab = useTableDesignerStore.getState().tabs['tab-1']
    expect(tab.connectionId).toBe('conn-1')
    expect(tab.mode).toBe('create')
    expect(tab.currentSchema.columns).toHaveLength(1)
  })
})

describe('useTableDesignerStore — isDirty', () => {
  it('isDirty is false for a blank create mode tab with no columns', () => {
    initCreateTab()
    expect(useTableDesignerStore.getState().tabs['tab-1'].isDirty).toBe(false)
  })

  it('isDirty is true in create mode after adding a column', () => {
    initCreateTab()
    useTableDesignerStore.getState().addColumn('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].isDirty).toBe(true)
  })

  it('isDirty is true in create mode after adding an index', () => {
    initCreateTab()
    useTableDesignerStore.getState().addIndex('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].isDirty).toBe(true)
  })

  it('isDirty is true in create mode after adding a FK', () => {
    initCreateTab()
    useTableDesignerStore.getState().addForeignKey('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].isDirty).toBe(true)
  })

  it('isDirty is true in alter mode after updating a column field', () => {
    seedAlterTab()
    useTableDesignerStore.getState().updateColumn('tab-1', 1, 'comment', 'changed')
    expect(useTableDesignerStore.getState().tabs['tab-1'].isDirty).toBe(true)
  })

  it('isDirty is false after discardChanges in alter mode', () => {
    seedAlterTab()
    useTableDesignerStore.getState().updateColumn('tab-1', 1, 'comment', 'changed')
    useTableDesignerStore.getState().discardChanges('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].isDirty).toBe(false)
  })

  it('isDirty is false after discardChanges in create mode', () => {
    initCreateTab()
    useTableDesignerStore.getState().addColumn('tab-1')
    useTableDesignerStore.getState().discardChanges('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].isDirty).toBe(false)
  })

  it('markClean sets isDirty to false', () => {
    seedAlterTab()
    useTableDesignerStore.getState().updateColumn('tab-1', 1, 'comment', 'changed')
    useTableDesignerStore.getState().markClean('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].isDirty).toBe(false)
  })
})

describe('useTableDesignerStore — column operations', () => {
  it('addColumn appends a new blank column', () => {
    initCreateTab()
    useTableDesignerStore.getState().addColumn('tab-1')

    const columns = useTableDesignerStore.getState().tabs['tab-1'].currentSchema.columns

    expect(columns[columns.length - 1]).toEqual({
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
  })

  it('changing a column type applies the type-aware default length and clears unsupported modifiers', () => {
    seedAlterTab()

    useTableDesignerStore.getState().updateColumn('tab-1', 0, 'typeModifier', 'UNSIGNED')
    useTableDesignerStore.getState().updateColumn('tab-1', 0, 'type', 'TINYINT')

    const column = useTableDesignerStore.getState().tabs['tab-1'].currentSchema.columns[0]
    expect(column?.length).toBe('4')
    expect(column?.typeModifier).toBe('UNSIGNED')

    useTableDesignerStore.getState().updateColumn('tab-1', 0, 'type', 'VARCHAR')
    const varcharColumn = useTableDesignerStore.getState().tabs['tab-1'].currentSchema.columns[0]
    expect(varcharColumn?.length).toBe('255')
    expect(varcharColumn?.typeModifier).toBe('')
  })

  it('type changes preserve compatible non-signed modifiers', () => {
    seedAlterTab()

    useTableDesignerStore.getState().updateColumn('tab-1', 0, 'typeModifier', 'UNSIGNED ZEROFILL')
    useTableDesignerStore.getState().updateColumn('tab-1', 0, 'type', 'INT')
    expect(
      useTableDesignerStore.getState().tabs['tab-1'].currentSchema.columns[0]?.typeModifier
    ).toBe('UNSIGNED ZEROFILL')

    useTableDesignerStore.getState().updateColumn('tab-1', 1, 'type', 'CHAR')
    useTableDesignerStore.getState().updateColumn('tab-1', 1, 'typeModifier', 'BINARY')
    useTableDesignerStore.getState().updateColumn('tab-1', 1, 'type', 'CHAR')
    expect(
      useTableDesignerStore.getState().tabs['tab-1'].currentSchema.columns[1]?.typeModifier
    ).toBe('BINARY')
  })

  it('length updates are clamped to the selected type maximum', () => {
    seedAlterTab()

    useTableDesignerStore.getState().updateColumn('tab-1', 0, 'type', 'TINYINT')
    useTableDesignerStore.getState().updateColumn('tab-1', 0, 'length', '255')

    expect(useTableDesignerStore.getState().tabs['tab-1'].currentSchema.columns[0]?.length).toBe(
      '4'
    )
  })

  it('deleteColumn removes the column at given index', () => {
    seedAlterTab()
    useTableDesignerStore.getState().deleteColumn('tab-1', 1)
    expect(
      useTableDesignerStore
        .getState()
        .tabs['tab-1'].currentSchema.columns.map((column) => column.name)
    ).toEqual(['id', 'role_id'])
  })

  it('deleteColumn removes index entries that referenced the deleted column', () => {
    seedAlterTab()
    useTableDesignerStore.getState().deleteColumn('tab-1', 2)

    expect(useTableDesignerStore.getState().tabs['tab-1'].currentSchema.indexes).toEqual([
      { name: 'PRIMARY', indexType: 'PRIMARY', columns: ['id'] },
      { name: 'idx_email', indexType: 'UNIQUE', columns: ['email'] },
    ])
  })

  it('deleteColumn removes FK entries where sourceColumn matches', () => {
    seedAlterTab()
    useTableDesignerStore.getState().deleteColumn('tab-1', 2)
    expect(useTableDesignerStore.getState().tabs['tab-1'].currentSchema.foreignKeys).toEqual([])
  })

  it('reorderColumn moves column from one index to another', () => {
    seedAlterTab()
    useTableDesignerStore.getState().reorderColumn('tab-1', 2, 1)

    expect(
      useTableDesignerStore
        .getState()
        .tabs['tab-1'].currentSchema.columns.map((column) => column.name)
    ).toEqual(['id', 'role_id', 'email'])
  })

  it('updateColumn with name field updates index columns and FK sourceColumn references', () => {
    seedAlterTab()
    useTableDesignerStore.getState().updateColumn('tab-1', 2, 'name', 'account_role_id')

    const tab = useTableDesignerStore.getState().tabs['tab-1']
    expect(
      tab.currentSchema.indexes.find((index) => index.name === 'idx_role_id')?.columns
    ).toEqual(['account_role_id'])
    expect(tab.currentSchema.foreignKeys[0]?.sourceColumn).toBe('account_role_id')
  })

  it('updateColumn sets validationErrors for empty name', () => {
    seedAlterTab()
    useTableDesignerStore.getState().updateColumn('tab-1', 1, 'name', '')
    expect(useTableDesignerStore.getState().tabs['tab-1'].validationErrors['columns.1.name']).toBe(
      'Column name is required'
    )
  })

  it('updateColumn sets validationErrors for duplicate name', () => {
    seedAlterTab()
    useTableDesignerStore.getState().updateColumn('tab-1', 1, 'name', 'id')
    expect(useTableDesignerStore.getState().tabs['tab-1'].validationErrors['columns.1.name']).toBe(
      'Duplicate column name'
    )
  })

  it('updateColumn clears validationErrors when name becomes valid', () => {
    seedAlterTab()
    useTableDesignerStore.getState().updateColumn('tab-1', 1, 'name', '')
    useTableDesignerStore.getState().updateColumn('tab-1', 1, 'name', 'email_address')
    expect(
      useTableDesignerStore.getState().tabs['tab-1'].validationErrors['columns.1.name']
    ).toBeUndefined()
  })
})

describe('useTableDesignerStore — table name', () => {
  it('updateTableName sets currentSchema.tableName and schedules DDL regen', async () => {
    initCreateTab()
    useTableDesignerStore.getState().updateTableName('tab-1', 'audit_log')

    expect(useTableDesignerStore.getState().tabs['tab-1'].currentSchema.tableName).toBe('audit_log')
    expect(getGenerateDdlCalls()).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(300)
    expect(getGenerateDdlCalls()).toHaveLength(1)
  })

  it('updateTableName sets validationErrors.tableName when name is empty', () => {
    initCreateTab()
    useTableDesignerStore.getState().updateTableName('tab-1', '')
    expect(useTableDesignerStore.getState().tabs['tab-1'].validationErrors.tableName).toBe(
      'Table name is required'
    )
  })

  it('updateTableName clears validationErrors.tableName when name is non-empty', () => {
    initCreateTab()
    useTableDesignerStore.getState().updateTableName('tab-1', '')
    useTableDesignerStore.getState().updateTableName('tab-1', 'audit_log')
    expect(
      useTableDesignerStore.getState().tabs['tab-1'].validationErrors.tableName
    ).toBeUndefined()
  })
})

describe('useTableDesignerStore — index operations', () => {
  it('addIndex appends a new blank index', () => {
    initCreateTab()
    useTableDesignerStore.getState().addIndex('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].currentSchema.indexes[0]).toEqual({
      name: '',
      indexType: 'INDEX',
      columns: [],
    })
  })

  it('deleteIndex removes the index at given index', () => {
    seedAlterTab()
    useTableDesignerStore.getState().deleteIndex('tab-1', 1)
    expect(
      useTableDesignerStore
        .getState()
        .tabs['tab-1'].currentSchema.indexes.map((index) => index.name)
    ).toEqual(['PRIMARY', 'idx_role_id'])
  })

  it('updateIndex updates a field on the index', () => {
    seedAlterTab()
    useTableDesignerStore.getState().updateIndex('tab-1', 1, 'name', 'uniq_email')
    expect(useTableDesignerStore.getState().tabs['tab-1'].currentSchema.indexes[1]?.name).toBe(
      'uniq_email'
    )
  })

  it('addIndex followed by updateIndex with duplicate name sets validationErrors', () => {
    seedAlterTab()
    useTableDesignerStore.getState().addIndex('tab-1')
    useTableDesignerStore.getState().updateIndex('tab-1', 3, 'name', 'idx_email')

    expect(useTableDesignerStore.getState().tabs['tab-1'].validationErrors['indexes.1.name']).toBe(
      'Duplicate index name'
    )
    expect(useTableDesignerStore.getState().tabs['tab-1'].validationErrors['indexes.3.name']).toBe(
      'Duplicate index name'
    )
  })

  it('updateIndex with zero columns sets validationErrors', () => {
    seedAlterTab()
    useTableDesignerStore.getState().updateIndex('tab-1', 1, 'columns', [])

    expect(
      useTableDesignerStore.getState().tabs['tab-1'].validationErrors['indexes.1.columns']
    ).toBe('At least one column required')
  })
})

describe('useTableDesignerStore — FK operations', () => {
  it('addForeignKey appends a new blank FK', () => {
    initCreateTab()
    useTableDesignerStore.getState().addForeignKey('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].currentSchema.foreignKeys[0]).toEqual({
      name: '',
      sourceColumn: '',
      referencedTable: '',
      referencedColumn: '',
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
      isComposite: false,
    })
  })

  it('deleteForeignKey removes the FK at given index', () => {
    seedAlterTab()
    useTableDesignerStore.getState().deleteForeignKey('tab-1', 0)
    expect(useTableDesignerStore.getState().tabs['tab-1'].currentSchema.foreignKeys).toEqual([])
  })
})

describe('useTableDesignerStore — properties', () => {
  it('updateProperties updates a property field', () => {
    initCreateTab()
    useTableDesignerStore.getState().updateProperties('tab-1', 'comment', 'logs table')
    expect(useTableDesignerStore.getState().tabs['tab-1'].currentSchema.properties.comment).toBe(
      'logs table'
    )
  })
})

describe('useTableDesignerStore — debounce', () => {
  it('updateColumn triggers exactly 1 regenerateDdl call after 300ms debounce when called 5 times rapidly', async () => {
    seedAlterTab('debounce-tab')
    invokeMock.mockClear()

    for (let i = 0; i < 5; i += 1) {
      useTableDesignerStore.getState().updateColumn('debounce-tab', 1, 'comment', `comment-${i}`)
    }

    expect(getGenerateDdlCalls()).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(300)

    expect(getGenerateDdlCalls()).toHaveLength(1)
  })
})

describe('useTableDesignerStore — discardChanges', () => {
  it('discardChanges in create mode resets tableName to empty string', () => {
    initCreateTab()
    useTableDesignerStore.getState().updateTableName('tab-1', 'scratch_table')
    useTableDesignerStore.getState().discardChanges('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].currentSchema.tableName).toBe('')
  })

  it('discardChanges clears validationErrors', () => {
    initCreateTab()
    useTableDesignerStore.getState().updateTableName('tab-1', '')
    useTableDesignerStore.getState().discardChanges('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].validationErrors).toEqual({})
  })

  it('discardChanges clears ddlWarnings', () => {
    initCreateTab()
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          ddlWarnings: ['warning'],
        },
      },
    }))
    useTableDesignerStore.getState().discardChanges('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].ddlWarnings).toEqual([])
  })

  it('discardChanges triggers DDL regeneration', async () => {
    seedAlterTab()
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          ddl: 'STALE SQL',
          ddlError: 'stale error',
          isDdlLoading: false,
        },
      },
    }))

    invokeMock.mockClear()
    useTableDesignerStore.getState().discardChanges('tab-1')

    expect(useTableDesignerStore.getState().tabs['tab-1'].ddl).toBe('')
    expect(useTableDesignerStore.getState().tabs['tab-1'].ddlError).toBeNull()
    expect(useTableDesignerStore.getState().tabs['tab-1'].isDdlLoading).toBe(true)

    await vi.runAllTimersAsync()
    await Promise.resolve()

    expect(getGenerateDdlCalls()).toHaveLength(1)
  })
})

describe('useTableDesignerStore — cleanupTab', () => {
  it('cleanupTab removes tab from store', () => {
    initCreateTab()
    useTableDesignerStore.getState().cleanupTab('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1']).toBeUndefined()
  })
})

describe('useTableDesignerStore — updateTabContext', () => {
  it('updateTabContext updates mode and objectName without affecting other state', () => {
    initCreateTab()
    useTableDesignerStore.getState().updateTableName('tab-1', 'draft_table')
    useTableDesignerStore.getState().updateTabContext('tab-1', {
      mode: 'alter',
      objectName: 'draft_table',
    })

    const tab = useTableDesignerStore.getState().tabs['tab-1']
    expect(tab.mode).toBe('alter')
    expect(tab.objectName).toBe('draft_table')
    expect(tab.currentSchema.tableName).toBe('draft_table')
  })
})

describe('useTableDesignerStore — loadSchema', () => {
  it('loadSchema in alter mode calls loadTableForDesigner with correct args', async () => {
    initAlterTab('load-tab')
    await useTableDesignerStore.getState().loadSchema('load-tab')

    expect(invokeMock).toHaveBeenCalledWith('load_table_for_designer', {
      connectionId: 'conn-1',
      database: 'app_db',
      tableName: 'users',
    })
  })

  it('loadSchema on success sets originalSchema and currentSchema', async () => {
    initAlterTab('load-tab')
    await useTableDesignerStore.getState().loadSchema('load-tab')

    const tab = useTableDesignerStore.getState().tabs['load-tab']
    expect(tab.originalSchema).toEqual(loadedSchema)
    expect(tab.currentSchema).toEqual(loadedSchema)
    expect(tab.isDirty).toBe(false)
  })

  it('loadSchema on error sets loadError', async () => {
    invokeMock.mockRejectedValueOnce(new Error('Load failed'))
    initAlterTab('load-tab')

    await useTableDesignerStore.getState().loadSchema('load-tab')

    expect(useTableDesignerStore.getState().tabs['load-tab'].loadError).toBe('Load failed')
  })
})

describe('useTableDesignerStore — regenerateDdl', () => {
  it('regenerateDdl calls generateTableDdl IPC', async () => {
    initCreateTab()
    useTableDesignerStore.getState().updateTableName('tab-1', 'users')
    await useTableDesignerStore.getState().regenerateDdl('tab-1')

    expect(invokeMock).toHaveBeenCalledWith('generate_table_ddl', {
      request: {
        originalSchema: null,
        currentSchema: {
          tableName: 'users',
          columns: [],
          indexes: [],
          foreignKeys: [],
          properties: defaultProperties(),
        },
        database: 'app_db',
        mode: 'create',
      },
    })
  })

  it('regenerateDdl sets ddl on success', async () => {
    initCreateTab()
    useTableDesignerStore.getState().updateTableName('tab-1', 'users')
    await useTableDesignerStore.getState().regenerateDdl('tab-1')
    expect(useTableDesignerStore.getState().tabs['tab-1'].ddl).toBe('CREATE TABLE users (...);')
  })

  it('regenerateDdl skips IPC and clears preview for blank create drafts', async () => {
    initCreateTab()
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          ddl: 'STALE SQL',
          ddlWarnings: ['stale warning'],
          ddlError: 'stale error',
          validationErrors: { tableName: 'Table name is required' },
        },
      },
    }))
    invokeMock.mockClear()

    await useTableDesignerStore.getState().regenerateDdl('tab-1')

    expect(getGenerateDdlCalls()).toHaveLength(0)
    expect(useTableDesignerStore.getState().tabs['tab-1'].ddl).toBe('')
    expect(useTableDesignerStore.getState().tabs['tab-1'].ddlWarnings).toEqual([])
    expect(useTableDesignerStore.getState().tabs['tab-1'].ddlError).toBeNull()
  })

  it('regenerateDdl sets ddlError on failure', async () => {
    initCreateTab()
    useTableDesignerStore.getState().updateTableName('tab-1', 'users')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          ddl: 'STALE SQL',
          ddlWarnings: ['stale warning'],
        },
      },
    }))
    invokeMock.mockRejectedValueOnce(new Error('DDL failed'))

    await useTableDesignerStore.getState().regenerateDdl('tab-1')

    expect(useTableDesignerStore.getState().tabs['tab-1'].ddl).toBe('')
    expect(useTableDesignerStore.getState().tabs['tab-1'].ddlWarnings).toEqual([])
    expect(useTableDesignerStore.getState().tabs['tab-1'].ddlError).toBe('DDL failed')
  })

  it('regenerateDdl ignores stale async responses from older requests', async () => {
    initCreateTab()
    useTableDesignerStore.getState().updateTableName('tab-1', 'users')

    const first = deferred<{ ddl: string; warnings: string[] }>()
    const second = deferred<{ ddl: string; warnings: string[] }>()

    invokeMock.mockReset()
    invokeMock
      .mockImplementationOnce(async (command) => {
        expect(command).toBe('generate_table_ddl')
        return first.promise
      })
      .mockImplementationOnce(async (command) => {
        expect(command).toBe('generate_table_ddl')
        return second.promise
      })

    const firstRun = useTableDesignerStore.getState().regenerateDdl('tab-1')
    const secondRun = useTableDesignerStore.getState().regenerateDdl('tab-1')

    second.resolve({ ddl: 'NEW SQL', warnings: ['new warning'] })
    await secondRun

    first.resolve({ ddl: 'OLD SQL', warnings: ['old warning'] })
    await firstRun

    expect(useTableDesignerStore.getState().tabs['tab-1'].ddl).toBe('NEW SQL')
    expect(useTableDesignerStore.getState().tabs['tab-1'].ddlWarnings).toEqual(['new warning'])
  })

  it('schema edits invalidate older in-flight DDL responses before debounce completes', async () => {
    initCreateTab()
    useTableDesignerStore.getState().updateTableName('tab-1', 'users')

    const first = deferred<{ ddl: string; warnings: string[] }>()
    invokeMock.mockReset()
    invokeMock.mockImplementationOnce(async (command) => {
      expect(command).toBe('generate_table_ddl')
      return first.promise
    })

    const firstRun = useTableDesignerStore.getState().regenerateDdl('tab-1')
    useTableDesignerStore.getState().updateTableName('tab-1', 'users_v2')

    first.resolve({ ddl: 'OLD SQL', warnings: ['old warning'] })
    await firstRun

    expect(useTableDesignerStore.getState().tabs['tab-1'].ddl).toBe('')
    expect(useTableDesignerStore.getState().tabs['tab-1'].ddlWarnings).toEqual([])
  })
})
