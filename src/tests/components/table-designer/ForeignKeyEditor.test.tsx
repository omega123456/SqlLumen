import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForeignKeyEditor } from '../../../components/table-designer/ForeignKeyEditor'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { ipc } from '../../ipc-mock'
import type { TableDesignerTabState } from '../../../stores/table-designer-store'

function makeTabState(overrides: Partial<TableDesignerTabState> = {}): TableDesignerTabState {
  return {
    connectionId: 'conn-1',
    databaseName: 'app_db',
    objectName: 'users',
    mode: 'alter',
    originalSchema: {
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
          name: 'role_id',
          type: 'INT',
          length: '11',
          nullable: false,
          isPrimaryKey: false,
          isAutoIncrement: false,
          defaultValue: { tag: 'NO_DEFAULT' },
          comment: '',
          originalName: 'role_id',
        },
      ],
      indexes: [{ name: 'PRIMARY', indexType: 'PRIMARY', columns: ['id'] }],
      foreignKeys: [],
      properties: {
        engine: 'InnoDB',
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
        autoIncrement: null,
        rowFormat: 'DEFAULT',
        comment: '',
      },
    },
    currentSchema: {
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
          name: 'role_id',
          type: 'INT',
          length: '11',
          nullable: false,
          isPrimaryKey: false,
          isAutoIncrement: false,
          defaultValue: { tag: 'NO_DEFAULT' },
          comment: '',
          originalName: 'role_id',
        },
      ],
      indexes: [{ name: 'PRIMARY', indexType: 'PRIMARY', columns: ['id'] }],
      foreignKeys: [
        {
          name: 'fk_users_role',
          sourceColumn: 'role_id',
          referencedDatabase: 'app_db',
          referencedTable: 'roles',
          referencedColumn: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'RESTRICT',
          isComposite: false,
        },
        {
          name: 'fk_users_team_membership',
          sourceColumn: 'role_id,team_id',
          referencedDatabase: 'app_db',
          referencedTable: 'teams',
          referencedColumn: 'role_id,team_id',
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
          isComposite: true,
        },
      ],
      properties: {
        engine: 'InnoDB',
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
        autoIncrement: null,
        rowFormat: 'DEFAULT',
        comment: '',
      },
    },
    isDirty: false,
    isLoading: false,
    loadError: null,
    ddl: '',
    ddlWarnings: [],
    isDdlLoading: false,
    ddlError: null,
    validationErrors: {},
    pendingNavigationAction: null,
    selectedSubTab: 'fks',
    ...overrides,
  }
}

function seedStore(overrides: Partial<TableDesignerTabState> = {}) {
  useTableDesignerStore.setState({
    tabs: {
      'tab-1': makeTabState(overrides),
    },
  })
}

describe('ForeignKeyEditor', () => {
  beforeEach(() => {
    useTableDesignerStore.getState().cleanupTab('tab-1')
    useTableDesignerStore.setState({ tabs: {} })
    ipc.override('list_databases', () => ['app_db', 'audit_db'])
    ipc.override('list_schema_objects', () => ['roles', 'teams'])
    ipc.override('list_columns', (args) => {
      const database = (args as { database?: string })?.database
      const table = (args as { table?: string })?.table
      if (database === 'audit_db' && table === 'audit_roles') {
        return [
          {
            name: 'audit_id',
            dataType: 'INT',
            nullable: false,
            columnKey: 'PRI',
            defaultValue: null,
            extra: '',
            ordinalPosition: 1,
          },
        ]
      }

      if (table === 'roles') {
        return [
          {
            name: 'id',
            dataType: 'INT',
            nullable: false,
            columnKey: 'PRI',
            defaultValue: null,
            extra: '',
            ordinalPosition: 1,
          },
        ]
      }

      return [
        {
          name: 'role_id',
          dataType: 'INT',
          nullable: false,
          columnKey: 'PRI',
          defaultValue: null,
          extra: '',
          ordinalPosition: 1,
        },
      ]
    })
  })

  it('renders FKs from store', async () => {
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    expect(await screen.findByDisplayValue('fk_users_role')).toBeInTheDocument()
    expect(screen.getByText('fk_users_team_membership')).toBeInTheDocument()
  })

  it('Add FK button calls store.addForeignKey', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('foreign-key-editor-add'))

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.foreignKeys).toHaveLength(
      3
    )
  })

  it('Delete button calls store.deleteForeignKey', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    await user.click(await screen.findByTestId('fk-delete-0'))

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.foreignKeys).toHaveLength(
      1
    )
    expect(screen.queryByDisplayValue('fk_users_role')).not.toBeInTheDocument()
  })

  it('source column dropdown lists current designer columns', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    await user.click(await screen.findByTestId('fk-source-column-0'))
    const labels = screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))
    expect(labels).toEqual(['Select column', 'id', 'role_id'])
  })

  it('composite FK row is shown as read-only', async () => {
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    await screen.findByDisplayValue('fk_users_role')

    expect(screen.getByTestId('fk-row-1')).toHaveTextContent('fk_users_team_membership')
    expect(screen.queryByTestId('fk-name-1')).not.toBeInTheDocument()
  })

  it('composite FK row shows warning badge', async () => {
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    expect(await screen.findByTestId('fk-composite-badge-1')).toHaveTextContent(
      'Multi-column — view only'
    )
  })

  it('composite FK row has no delete button', async () => {
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    await screen.findByDisplayValue('fk_users_role')

    expect(screen.queryByTestId('fk-delete-1')).not.toBeInTheDocument()
  })

  it('regular FK row shows editable inputs', async () => {
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    expect(await screen.findByTestId('fk-name-0')).toBeInTheDocument()
    expect(screen.getByTestId('fk-source-column-0')).toBeInTheDocument()
    expect(screen.getByTestId('fk-referenced-database-0')).toBeInTheDocument()
    expect(screen.getByTestId('fk-referenced-table-0')).toBeInTheDocument()
    expect(screen.getByTestId('fk-referenced-column-0')).toBeInTheDocument()
  })

  it('Delete Selected button deletes the selected regular FK and stays disabled for composite rows', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    await user.click(await screen.findByTestId('fk-row-0'))
    await user.click(screen.getByTestId('foreign-key-editor-delete-selected'))

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.foreignKeys).toHaveLength(
      1
    )

    await user.click(screen.getByTestId('fk-row-0'))
    expect(screen.getByTestId('foreign-key-editor-delete-selected')).toBeDisabled()
  })

  it('changing referenced table clears referenced column and updates store', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    const tableSelect = await screen.findByTestId('fk-referenced-table-0')
    await user.click(tableSelect)
    await user.click(screen.getByRole('option', { name: 'teams' }))

    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.foreignKeys[0]
    ).toMatchObject({
      referencedDatabase: 'app_db',
      referencedTable: 'teams',
      referencedColumn: '',
    })
  })

  it('changing referenced database clears table and column and loads tables from that database', async () => {
    const user = userEvent.setup()
    ipc.override('list_schema_objects', (args) => {
      const database = (args as { database?: string })?.database
      if (database === 'audit_db') {
        return ['audit_roles']
      }

      return ['roles', 'teams']
    })

    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    await user.click(await screen.findByTestId('fk-referenced-database-0'))
    await user.click(screen.getByRole('option', { name: 'audit_db' }))

    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.foreignKeys[0]
    ).toMatchObject({
      referencedDatabase: 'audit_db',
      referencedTable: '',
      referencedColumn: '',
    })

    await waitFor(() => {
      expect(ipc.calls('list_schema_objects')).toContainEqual({
        connectionId: 'conn-1',
        database: 'audit_db',
        objectType: 'table',
      })
    })

    await user.click(screen.getByTestId('fk-referenced-table-0'))
    expect(screen.getByRole('option', { name: 'audit_roles' })).toBeInTheDocument()
  })

  it('ON DELETE and ON UPDATE dropdowns update store', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    await user.click(await screen.findByTestId('fk-on-delete-0'))
    await user.click(screen.getByRole('option', { name: 'SET NULL' }))
    await user.click(screen.getByTestId('fk-on-update-0'))
    await user.click(screen.getByRole('option', { name: 'CASCADE' }))

    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.foreignKeys[0]
    ).toMatchObject({
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    })
  })

  it('loads referenced columns for selected table', async () => {
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    await waitFor(() => {
      expect(ipc.calls('list_columns')).toContainEqual({
        connectionId: 'conn-1',
        database: 'app_db',
        table: 'roles',
      })
    })

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('fk-referenced-column-0'))
    const labels = screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))
    expect(labels).toEqual(['Select column', 'id'])
  })

  it('loads referenced columns from the selected database', async () => {
    const user = userEvent.setup()
    ipc.override('list_schema_objects', (args) => {
      const database = (args as { database?: string })?.database
      if (database === 'audit_db') {
        return ['audit_roles']
      }

      return ['roles', 'teams']
    })

    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        foreignKeys: [
          {
            name: 'fk_users_role',
            sourceColumn: 'role_id',
            referencedDatabase: 'audit_db',
            referencedTable: 'audit_roles',
            referencedColumn: 'audit_id',
            onDelete: 'CASCADE',
            onUpdate: 'RESTRICT',
            isComposite: false,
          },
        ],
      },
    })
    render(<ForeignKeyEditor tabId="tab-1" />)

    await waitFor(() => {
      expect(ipc.calls('list_columns')).toContainEqual({
        connectionId: 'conn-1',
        database: 'audit_db',
        table: 'audit_roles',
      })
    })

    await user.click(await screen.findByTestId('fk-referenced-column-0'))
    const labels = screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))
    expect(labels).toEqual(['Select column', 'audit_id'])
  })

  it('falls back to text input when referenced table columns are unavailable', async () => {
    const user = userEvent.setup()
    ipc.override('list_columns', () => [])
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    const referencedColumnInput = (await screen.findByTestId(
      'fk-referenced-column-0'
    )) as HTMLInputElement
    expect(referencedColumnInput.tagName).toBe('INPUT')

    await user.clear(referencedColumnInput)
    await user.type(referencedColumnInput, 'custom_id')

    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.foreignKeys[0]?.referencedColumn
    ).toBe('custom_id')
  })

  it('logs and recovers when referenced tables fail to load', async () => {
    const user = userEvent.setup()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ipc.override('list_schema_objects', () => {
      throw new Error('tables failed')
    })
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    await waitFor(() => {
      expect(errorSpy).not.toHaveBeenCalled()
    })

    await user.click(await screen.findByTestId('fk-referenced-table-0'))
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveAccessibleName('Select table')
  })

  it('logs and falls back when referenced columns fail to load', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ipc.override('list_columns', () => {
      throw new Error('columns failed')
    })
    seedStore()
    render(<ForeignKeyEditor tabId="tab-1" />)

    await waitFor(() => {
      expect(errorSpy).not.toHaveBeenCalled()
    })

    const referencedColumnInput = (await screen.findByTestId(
      'fk-referenced-column-0'
    )) as HTMLInputElement
    expect(referencedColumnInput.tagName).toBe('INPUT')
  })
})
