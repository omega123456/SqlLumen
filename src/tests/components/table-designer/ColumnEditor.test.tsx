import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ColumnEditor } from '../../../components/table-designer/ColumnEditor'
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
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          defaultValue: { tag: 'NULL_DEFAULT' },
          comment: '',
          originalName: 'email',
        },
      ],
      indexes: [],
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
          nullable: true,
          isPrimaryKey: false,
          isAutoIncrement: false,
          defaultValue: { tag: 'NULL_DEFAULT' },
          comment: '',
          originalName: 'email',
        },
      ],
      indexes: [],
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
    selectedSubTab: 'columns',
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

describe('ColumnEditor', () => {
  beforeEach(() => {
    useTableDesignerStore.getState().cleanupTab('tab-1')
    useTableDesignerStore.setState({ tabs: {} })
  })

  it('renders columns from store', () => {
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    expect(screen.getByDisplayValue('id')).toBeInTheDocument()
    expect(screen.getByDisplayValue('email')).toBeInTheDocument()
  })

  it('keeps hook order stable when the designer tab state appears after first render', async () => {
    render(<ColumnEditor tabId="tab-1" />)

    await act(async () => {
      seedStore()
    })

    expect(screen.getByTestId('column-editor')).toBeInTheDocument()
    expect(screen.getByDisplayValue('id')).toBeInTheDocument()
  })

  it('clicking Add Column calls store.addColumn', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-editor-add'))

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns).toHaveLength(3)
  })

  it('clicking delete button removes column', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-delete-1'))

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns).toHaveLength(1)
    expect(screen.queryByDisplayValue('email')).not.toBeInTheDocument()
  })

  it('editing Name field updates store.updateColumn', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    const input = screen.getByTestId('column-name-1')
    await user.clear(input)
    await user.type(input, 'email_address')

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.name).toBe(
      'email_address'
    )
  })

  it('TypeCombobox change updates column type in store', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-type-1'))
    await user.click(screen.getByRole('option', { name: 'TEXT' }))

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.type).toBe(
      'TEXT'
    )
  })

  it('changing type clears an existing type modifier', async () => {
    const user = userEvent.setup()
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          makeTabState().currentSchema.columns[0],
          {
            ...makeTabState().currentSchema.columns[1],
            type: 'INT',
            typeModifier: 'UNSIGNED',
          },
        ],
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-type-1'))
    await user.click(screen.getByRole('option', { name: 'VARCHAR' }))

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.type).toBe(
      'VARCHAR'
    )
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.typeModifier
    ).toBe('')
  })

  it('changing a new column type to TINYINT resets length to the type default and enables signedness', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-editor-add'))

    await user.click(screen.getByTestId('column-type-2'))
    await user.click(screen.getByRole('option', { name: 'TINYINT' }))

    expect(screen.getByTestId('column-length-2')).toHaveValue('4')
    expect(screen.getByTestId('column-signedness-2')).toBeEnabled()
    expect(screen.getByTestId('column-signedness-2')).toHaveValue('SIGNED')
  })

  it('signedness toggles preserve non-signed modifiers like ZEROFILL', async () => {
    const user = userEvent.setup()
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          {
            ...makeTabState().currentSchema.columns[0],
            type: 'INT',
            typeModifier: 'UNSIGNED ZEROFILL',
          },
          makeTabState().currentSchema.columns[1],
        ],
      },
      originalSchema: {
        ...makeTabState().originalSchema!,
        columns: [
          {
            ...makeTabState().originalSchema!.columns[0],
            type: 'INT',
            typeModifier: 'UNSIGNED ZEROFILL',
          },
          makeTabState().originalSchema!.columns[1],
        ],
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    await user.selectOptions(screen.getByTestId('column-signedness-0'), 'SIGNED')
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[0]?.typeModifier
    ).toBe('ZEROFILL')

    await user.selectOptions(screen.getByTestId('column-signedness-0'), 'UNSIGNED')
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[0]?.typeModifier
    ).toBe('UNSIGNED ZEROFILL')
  })

  it('signedness dropdown shows unsigned for composite modifiers and Escape restores the full modifier', async () => {
    const user = userEvent.setup()
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          {
            ...makeTabState().currentSchema.columns[0],
            type: 'INT',
            typeModifier: 'UNSIGNED ZEROFILL',
          },
          makeTabState().currentSchema.columns[1],
        ],
      },
      originalSchema: {
        ...makeTabState().originalSchema!,
        columns: [
          {
            ...makeTabState().originalSchema!.columns[0],
            type: 'INT',
            typeModifier: 'UNSIGNED ZEROFILL',
          },
          makeTabState().originalSchema!.columns[1],
        ],
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    const signedness = screen.getByTestId('column-signedness-0')
    expect(signedness).toHaveValue('UNSIGNED')

    await user.click(signedness)
    await user.selectOptions(signedness, 'SIGNED')
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[0]?.typeModifier
    ).toBe('ZEROFILL')

    await user.keyboard('{Escape}')
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[0]?.typeModifier
    ).toBe('UNSIGNED ZEROFILL')
    expect(screen.getByTestId('column-signedness-0')).toHaveValue('UNSIGNED')
  })

  it('re-selecting the same type preserves non-signed modifiers like BINARY', async () => {
    const user = userEvent.setup()
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          {
            ...makeTabState().currentSchema.columns[0],
            type: 'CHAR',
            length: '36',
            typeModifier: 'BINARY',
          },
          makeTabState().currentSchema.columns[1],
        ],
      },
      originalSchema: {
        ...makeTabState().originalSchema!,
        columns: [
          {
            ...makeTabState().originalSchema!.columns[0],
            type: 'CHAR',
            length: '36',
            typeModifier: 'BINARY',
          },
          makeTabState().originalSchema!.columns[1],
        ],
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-type-0'))
    await user.click(screen.getByRole('option', { name: 'CHAR' }))

    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[0]?.typeModifier
    ).toBe('BINARY')
  })

  it('length input clamps values to the selected type maximum', async () => {
    const user = userEvent.setup()
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          {
            ...makeTabState().currentSchema.columns[0],
            type: 'TINYINT',
            length: '4',
          },
          makeTabState().currentSchema.columns[1],
        ],
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    const lengthInput = screen.getByTestId('column-length-0')
    await user.clear(lengthInput)
    await user.type(lengthInput, '255')

    expect(lengthInput).toHaveValue('4')
    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[0]?.length).toBe(
      '4'
    )
  })

  it('signedness is type-aware, can be toggled for numeric types, and clears for non-numeric types', async () => {
    const user = userEvent.setup()
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          {
            ...makeTabState().currentSchema.columns[0],
            type: 'INT',
            typeModifier: '',
          },
          makeTabState().currentSchema.columns[1],
        ],
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    const signednessSelect = screen.getByTestId('column-signedness-0')
    expect(signednessSelect).toBeEnabled()

    await user.selectOptions(signednessSelect, 'UNSIGNED')
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[0]?.typeModifier
    ).toBe('UNSIGNED')

    await user.click(screen.getByTestId('column-type-0'))
    await user.click(screen.getByRole('option', { name: 'VARCHAR' }))

    expect(screen.getByTestId('column-signedness-0')).toBeDisabled()
    expect(screen.getByTestId('column-signedness-0')).toHaveValue('SIGNED')
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[0]?.typeModifier
    ).toBe('')
  })

  it('re-selecting the same type preserves an existing type modifier', async () => {
    const user = userEvent.setup()
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          makeTabState().currentSchema.columns[0],
          {
            ...makeTabState().currentSchema.columns[1],
            type: 'INT',
            typeModifier: 'UNSIGNED',
          },
        ],
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-type-1'))
    await user.click(screen.getByRole('option', { name: 'INT' }))

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.type).toBe(
      'INT'
    )
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.typeModifier
    ).toBe('UNSIGNED')
  })

  it('Length field disabled for types in TYPES_WITHOUT_LENGTH', () => {
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          makeTabState().currentSchema.columns[0],
          {
            ...makeTabState().currentSchema.columns[1],
            type: 'TEXT',
          },
        ],
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    expect(screen.getByTestId('column-length-1')).toBeDisabled()
  })

  it('Length field enabled for VARCHAR', () => {
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    expect(screen.getByTestId('column-length-1')).not.toBeDisabled()
  })

  it('validation error border shown on Name cell when error exists', () => {
    seedStore({
      validationErrors: {
        'columns.1.name': 'Duplicate column name',
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    expect(screen.getByTestId('column-name-1')).toHaveAttribute('aria-invalid', 'true')
  })

  it('modified cell indicator shown on altered cell in alter mode', () => {
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          makeTabState().currentSchema.columns[0],
          {
            ...makeTabState().currentSchema.columns[1],
            comment: 'changed',
          },
        ],
      },
      isDirty: true,
    })
    render(<ColumnEditor tabId="tab-1" />)

    expect(screen.getByTestId('cell-1-comment-modified')).toBeInTheDocument()
  })

  it('move up and move down buttons reorder the selected row', async () => {
    const user = userEvent.setup()
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          ...makeTabState().currentSchema.columns,
          {
            name: 'created_at',
            type: 'DATETIME',
            length: '',
            nullable: true,
            isPrimaryKey: false,
            isAutoIncrement: false,
            defaultValue: { tag: 'NO_DEFAULT' },
            comment: '',
            originalName: 'created_at',
          },
        ],
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-row-2'))
    await user.click(screen.getByTestId('column-editor-move-up'))
    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.name).toBe(
      'created_at'
    )

    await user.click(screen.getByTestId('column-editor-move-down'))
    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[2]?.name).toBe(
      'created_at'
    )
  })

  it('checking PK also clears nullable and unchecking PK clears auto increment', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-pk-1'))
    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.nullable).toBe(
      false
    )

    await act(async () => {
      useTableDesignerStore.getState().updateColumn('tab-1', 1, 'isAutoIncrement', true)
    })
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.isAutoIncrement
    ).toBe(true)

    await user.click(screen.getByTestId('column-pk-1'))
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.isAutoIncrement
    ).toBe(false)
  })

  it('default value popover updates to NULL and literal value', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-default-button-0'))
    await user.click(
      within(screen.getByTestId('column-default-popover-0')).getByRole('button', { name: 'NULL' })
    )
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[0]?.defaultValue
    ).toEqual({
      tag: 'NULL_DEFAULT',
    })

    await user.click(screen.getByTestId('column-default-button-0'))
    await user.click(
      within(screen.getByTestId('column-default-popover-0')).getByRole('button', {
        name: 'Literal',
      })
    )
    const literalInput = screen.getByTestId('column-default-literal-0')
    await user.type(literalInput, '42')
    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[0]?.defaultValue
    ).toEqual({
      tag: 'LITERAL',
      value: '42',
    })
  })

  it('literal default mode still allows switching back to No Default', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-default-button-0'))
    await user.click(
      within(screen.getByTestId('column-default-popover-0')).getByRole('button', {
        name: 'Literal',
      })
    )

    expect(screen.getByTestId('column-default-literal-0')).toBeInTheDocument()
    await user.click(screen.getByTestId('column-default-button-0'))
    await user.click(
      within(screen.getByTestId('column-default-popover-0')).getByRole('button', {
        name: 'No Default',
      })
    )

    expect(
      useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[0]?.defaultValue
    ).toEqual({ tag: 'NO_DEFAULT' })
    expect(screen.queryByTestId('column-default-literal-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('column-default-button-0')).toBeInTheDocument()
  })

  it('ghost add row appends a column', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    await user.click(screen.getByTestId('column-editor-ghost-add'))

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns).toHaveLength(3)
  })

  it('Tab key on Name input focuses the Type input', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    const nameInput = screen.getByTestId('column-name-0')
    await user.click(nameInput)
    await user.keyboard('{Tab}')

    await waitFor(() => {
      expect(screen.getByTestId('column-type-0')).toHaveFocus()
    })
  })

  it('Enter key on Name input blurs and moves to next row', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    const nameInput = screen.getByTestId('column-name-0')
    await user.click(nameInput)
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByTestId('column-name-1')).toHaveFocus()
    })
    expect(nameInput).not.toHaveFocus()
  })

  it('Escape key reverts uncommitted Name change', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    const nameInput = screen.getByTestId('column-name-1')
    await user.click(nameInput)
    await user.clear(nameInput)
    await user.type(nameInput, 'temporary_name')

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.name).toBe(
      'temporary_name'
    )

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns[1]?.name).toBe(
        'email'
      )
    })
    expect(screen.getByTestId('column-name-1')).toHaveValue('email')
  })

  it('Shift-Tab on Type input focuses the previous Name input', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    const typeInput = screen.getByTestId('column-type-0')
    await user.click(typeInput)
    await user.keyboard('{Shift>}{Tab}{/Shift}')

    await waitFor(() => {
      expect(screen.getByTestId('column-name-0')).toHaveFocus()
    })
  })

  it('Tab on last comment input adds a new row and focuses the new Name input', async () => {
    const user = userEvent.setup()
    seedStore()
    render(<ColumnEditor tabId="tab-1" />)

    const commentInput = screen.getByTestId('column-comment-1')
    await user.click(commentInput)
    await user.keyboard('{Tab}')

    await waitFor(() => {
      expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.columns).toHaveLength(3)
      expect(screen.getByTestId('column-name-2')).toHaveFocus()
    })
  })

  it('Escape on comment input reverts uncommitted comment change', async () => {
    const user = userEvent.setup()
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          makeTabState().currentSchema.columns[0],
          {
            ...makeTabState().currentSchema.columns[1],
            comment: 'existing comment',
          },
        ],
      },
      originalSchema: {
        ...makeTabState().originalSchema!,
        columns: [
          makeTabState().originalSchema!.columns[0],
          {
            ...makeTabState().originalSchema!.columns[1],
            comment: 'existing comment',
          },
        ],
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    const commentInput = screen.getByTestId('column-comment-1')
    await user.click(commentInput)
    await user.clear(commentInput)
    await user.type(commentInput, 'draft comment')
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.getByTestId('column-comment-1')).toHaveValue('existing comment')
    })
  })

  it('Tab skips disabled length input and focuses the Default button', async () => {
    const user = userEvent.setup()
    seedStore({
      currentSchema: {
        ...makeTabState().currentSchema,
        columns: [
          {
            ...makeTabState().currentSchema.columns[0],
            type: 'TEXT',
            length: '',
          },
          makeTabState().currentSchema.columns[1],
        ],
      },
    })
    render(<ColumnEditor tabId="tab-1" />)

    const typeInput = screen.getByTestId('column-type-0')
    await user.click(typeInput)
    await user.keyboard('{Tab}')

    await waitFor(() => {
      expect(screen.getByTestId('column-default-button-0')).toHaveFocus()
    })
  })
})
