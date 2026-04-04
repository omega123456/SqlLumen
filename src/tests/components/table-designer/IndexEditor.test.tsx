import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexEditor } from '../../../components/table-designer/IndexEditor'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import type { TableDesignerTabState } from '../../../stores/table-designer-store'

vi.mock('../../../lib/table-designer-commands', () => ({
  loadTableForDesigner: vi.fn().mockResolvedValue(undefined),
  generateTableDdl: vi.fn().mockResolvedValue({ ddl: 'ALTER TABLE `users` ...', warnings: [] }),
  applyTableDdl: vi.fn().mockResolvedValue(undefined),
}))

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
      ],
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
    isDirty: false,
    isLoading: false,
    loadError: null,
    ddl: '',
    ddlWarnings: [],
    isDdlLoading: false,
    ddlError: null,
    validationErrors: {},
    pendingNavigationAction: null,
    selectedSubTab: 'indexes',
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

describe('IndexEditor', () => {
  beforeEach(() => {
    useTableDesignerStore.getState().cleanupTab('tab-1')
    useTableDesignerStore.setState({ tabs: {} })
  })

  it('renders PRIMARY index row as non-editable', () => {
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    expect(screen.getByTestId('index-primary-name')).toHaveTextContent('PRIMARY')
    expect(screen.getByTestId('index-primary-type')).toHaveTextContent('PRIMARY')
    expect(screen.queryByDisplayValue('PRIMARY')).not.toBeInTheDocument()
  })

  it('PRIMARY row has no delete button', () => {
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    expect(screen.queryByLabelText(/Delete index PRIMARY/i)).not.toBeInTheDocument()
  })

  it('PRIMARY row columns are derived from PK columns in schema', () => {
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: makeTabState().currentSchema.columns.map((column) => ({
          ...column,
          isPrimaryKey: column.name === 'id' || column.name === 'email',
        })),
      },
    })
    render(<IndexEditor tabId="tab-1" />)

    expect(screen.getByTestId('index-primary-columns')).toHaveTextContent('id, email')
  })

  it('renders non-PRIMARY indexes from store', () => {
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    expect(screen.getByDisplayValue('idx_email')).toBeInTheDocument()
    expect(screen.getByDisplayValue('idx_role_id')).toBeInTheDocument()
  })

  it('Add Index button calls store.addIndex', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('index-editor-add'))

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.indexes).toHaveLength(4)
  })

  it('Delete button calls store.deleteIndex for non-PRIMARY row', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('index-delete-0'))

    expect(
      useTableDesignerStore
        .getState()
        .tabs['tab-1']?.currentSchema.indexes.map((index) => index.name)
    ).toEqual(['PRIMARY', 'idx_role_id'])
  })

  it('Delete button absent/disabled for PRIMARY row', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('index-row-primary'))

    expect(screen.getByTestId('index-editor-delete-selected')).toBeDisabled()
  })

  it('Delete Selected button deletes the selected non-PRIMARY row', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('index-row-1'))
    await user.click(screen.getByTestId('index-editor-delete-selected'))

    expect(
      useTableDesignerStore
        .getState()
        .tabs['tab-1']?.currentSchema.indexes.map((index) => index.name)
    ).toEqual(['PRIMARY', 'idx_email'])
  })

  it('Columns popover shows all current column names as checkboxes', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('index-columns-button-0'))

    expect(screen.getByTestId('index-columns-button-0-option-id')).toBeInTheDocument()
    expect(screen.getByTestId('index-columns-button-0-option-email')).toBeInTheDocument()
    expect(screen.getByTestId('index-columns-button-0-option-role_id')).toBeInTheDocument()
  })

  it('Columns selector uses a multi-select listbox rendered in document.body', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('index-columns-button-0'))

    const listbox = screen.getByRole('listbox', { name: 'Index columns' })
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true')
    expect(listbox.parentElement).toBe(document.body)
    expect(screen.getByRole('option', { name: 'id' })).toBeInTheDocument()
  })

  it('Columns popover multi-select updates index columns in store', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('index-columns-button-0'))
    await user.click(screen.getByTestId('index-columns-button-0-option-id'))

    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.indexes[1]?.columns
    ).toEqual(['id', 'email'])
  })

  it('Columns selector closes on outside click', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('index-columns-button-0'))
    expect(screen.getByRole('listbox', { name: 'Index columns' })).toBeInTheDocument()

    await user.click(document.body)

    expect(screen.queryByRole('listbox', { name: 'Index columns' })).not.toBeInTheDocument()
  })

  it('Columns selector shows empty state when there are no designer columns', () => {
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [],
      },
    })
    render(<IndexEditor tabId="tab-1" />)

    expect(screen.getByTestId('index-columns-button-0')).toHaveTextContent('Add columns first')
  })

  it('Type dropdown update calls store.updateIndex', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<IndexEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('index-type-1'))
    await user.click(screen.getByRole('option', { name: 'FULLTEXT' }))

    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.indexes[2]?.indexType
    ).toBe('FULLTEXT')
  })

  it('shows validation error on duplicate index name', () => {
    seedStore({
      validationErrors: {
        'indexes.1.name': 'Duplicate index name',
      },
    })
    render(<IndexEditor tabId="tab-1" />)

    expect(screen.getByTestId('index-name-0')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('index-name-error-0')).toHaveTextContent('Duplicate index name')
  })

  it('shows validation error when columns is empty', () => {
    seedStore({
      validationErrors: {
        'indexes.2.columns': 'At least one column required',
      },
    })
    render(<IndexEditor tabId="tab-1" />)

    expect(screen.getByTestId('index-columns-button-1')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('index-columns-error-1')).toHaveTextContent(
      'At least one column required'
    )
  })
})
