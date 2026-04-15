import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TableDesignerTab } from '../../../components/table-designer/TableDesignerTab'
import { useSchemaStore } from '../../../stores/schema-store'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { useThemeStore } from '../../../stores/theme-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { TableDesignerTab as TableDesignerTabType } from '../../../types/schema'

vi.mock('../../../lib/table-designer-commands', () => ({
  loadTableForDesigner: vi.fn().mockResolvedValue({
    tableName: 'users',
    columns: [],
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
  }),
  generateTableDdl: vi.fn().mockResolvedValue({ ddl: 'ALTER TABLE `users` ...', warnings: [] }),
  applyTableDdl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../lib/schema-index-commands', () => ({
  invalidateSchemaIndex: vi.fn().mockResolvedValue(undefined),
  buildSchemaIndex: vi.fn().mockResolvedValue(undefined),
}))

import {
  applyTableDdl,
  generateTableDdl,
  loadTableForDesigner,
} from '../../../lib/table-designer-commands'

vi.mock('../../../components/table-designer/ColumnEditor', () => ({
  ColumnEditor: ({ tabId }: { tabId: string }) => (
    <div data-testid="column-editor">editor {tabId}</div>
  ),
}))

vi.mock('../../../components/table-designer/IndexEditor', () => ({
  IndexEditor: ({ tabId }: { tabId: string }) => (
    <div data-testid="index-editor">indexes {tabId}</div>
  ),
}))

vi.mock('../../../components/table-designer/ForeignKeyEditor', () => ({
  ForeignKeyEditor: ({ tabId }: { tabId: string }) => (
    <div data-testid="foreign-key-editor">foreign keys {tabId}</div>
  ),
}))

vi.mock('../../../components/table-designer/TablePropertiesEditor', () => ({
  TablePropertiesEditor: ({ tabId }: { tabId: string }) => (
    <div data-testid="table-properties-editor">properties {tabId}</div>
  ),
}))

vi.mock('../../../components/table-designer/DdlPreviewTab', () => ({
  DdlPreviewTab: ({ tabId }: { tabId: string }) => (
    <div data-testid="ddl-preview-tab">ddl {tabId}</div>
  ),
}))

function makeTab(overrides: Partial<TableDesignerTabType> = {}): TableDesignerTabType {
  return {
    id: 'tab-1',
    type: 'table-designer',
    label: 'users',
    connectionId: 'conn-1',
    mode: 'alter',
    databaseName: 'app_db',
    objectName: 'users',
    ...overrides,
  }
}

beforeEach(() => {
  useTableDesignerStore.getState().cleanupTab('tab-1')
  useTableDesignerStore.setState({ tabs: {} })
  useWorkspaceStore.setState({ tabsByConnection: {}, activeTabByConnection: {} })
  useSchemaStore.setState({ connectionStates: {} })
  useThemeStore.setState({ theme: 'dark', resolvedTheme: 'dark' })
  vi.mocked(loadTableForDesigner).mockResolvedValue({
    tableName: 'users',
    columns: [],
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
  })
  vi.mocked(generateTableDdl).mockResolvedValue({ ddl: 'ALTER TABLE `users` ...', warnings: [] })
  vi.mocked(applyTableDdl).mockResolvedValue(undefined)
})

describe('TableDesignerTab', () => {
  it('renders loading state while schema loads', () => {
    useTableDesignerStore.setState({
      tabs: {
        'tab-1': {
          connectionId: 'conn-1',
          databaseName: 'app_db',
          objectName: 'users',
          mode: 'alter',
          originalSchema: null,
          currentSchema: {
            tableName: '',
            columns: [],
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
          isLoading: true,
          loadError: null,
          ddl: '',
          ddlWarnings: [],
          isDdlLoading: false,
          ddlError: null,
          validationErrors: {},
          pendingNavigationAction: null,
          selectedSubTab: 'columns',
        },
      },
    })

    render(<TableDesignerTab tab={makeTab()} />)
    expect(screen.getByTestId('table-designer-loading')).toBeInTheDocument()
  })

  it('renders alter mode header with table name as read-only label', () => {
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          currentSchema: {
            ...state.tabs['tab-1'].currentSchema,
            tableName: 'users',
          },
        },
      },
    }))

    render(<TableDesignerTab tab={makeTab()} />)
    expect(screen.getByText('Alter Table:')).toBeInTheDocument()
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.queryByTestId('table-designer-name-input')).not.toBeInTheDocument()
  })

  it('renders create mode header with table name text input', () => {
    useTableDesignerStore.getState().initTab('tab-1', 'create', 'conn-1', 'app_db', '__new_table__')
    render(<TableDesignerTab tab={makeTab({ mode: 'create', objectName: '__new_table__' })} />)

    expect(screen.getByText('Create Table')).toBeInTheDocument()
    expect(screen.getByTestId('table-designer-name-input')).toBeInTheDocument()
  })

  it('renders header and content inside elevated card surfaces', () => {
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    render(<TableDesignerTab tab={makeTab()} />)

    expect(screen.getByTestId('table-designer-header-card')).toHaveClass('ui-elevated-surface')
    expect(screen.getByTestId('table-designer-content-card')).toHaveClass('ui-elevated-surface')
  })

  it('typing in create mode table name input calls store.updateTableName', async () => {
    const user = userEvent.setup()
    useTableDesignerStore.getState().initTab('tab-1', 'create', 'conn-1', 'app_db', '__new_table__')
    render(<TableDesignerTab tab={makeTab({ mode: 'create', objectName: '__new_table__' })} />)

    const input = screen.getByTestId('table-designer-name-input')
    await user.type(input, 'audit_log')

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.tableName).toBe(
      'audit_log'
    )
  })

  it('Apply Changes button disabled when isDirty is false', () => {
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    render(<TableDesignerTab tab={makeTab()} />)
    expect(screen.getByTestId('table-designer-apply')).toBeDisabled()
  })

  it('Apply Changes button disabled when validationErrors is non-empty', () => {
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          isDirty: true,
          validationErrors: { tableName: 'Required' },
        },
      },
    }))

    render(<TableDesignerTab tab={makeTab()} />)
    expect(screen.getByTestId('table-designer-apply')).toBeDisabled()
  })

  it('Apply Changes button disabled when isDdlLoading is true', () => {
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          isDirty: true,
          isDdlLoading: true,
        },
      },
    }))

    render(<TableDesignerTab tab={makeTab()} />)
    expect(screen.getByTestId('table-designer-apply')).toBeDisabled()
  })

  it('Apply Changes button disabled when in create mode and tableName is empty', () => {
    useTableDesignerStore.getState().initTab('tab-1', 'create', 'conn-1', 'app_db', '__new_table__')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          isDirty: true,
        },
      },
    }))

    render(<TableDesignerTab tab={makeTab({ mode: 'create', objectName: '__new_table__' })} />)
    expect(screen.getByTestId('table-designer-apply')).toBeDisabled()
  })

  it('Discard button calls store.discardChanges', async () => {
    const user = userEvent.setup()
    useTableDesignerStore.getState().initTab('tab-1', 'create', 'conn-1', 'app_db', '__new_table__')
    useTableDesignerStore.getState().updateTableName('tab-1', 'audit_log')
    render(<TableDesignerTab tab={makeTab({ mode: 'create', objectName: '__new_table__' })} />)

    await user.click(screen.getByTestId('table-designer-discard'))

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.tableName).toBe('')
  })

  it('remount does not re-initialise store when state already exists', () => {
    useTableDesignerStore.getState().initTab('tab-1', 'create', 'conn-1', 'app_db', '__new_table__')
    useTableDesignerStore.getState().updateTableName('tab-1', 'draft_users')

    const { rerender } = render(
      <TableDesignerTab tab={makeTab({ mode: 'create', objectName: '__new_table__' })} />
    )
    rerender(<TableDesignerTab tab={makeTab({ mode: 'create', objectName: '__new_table__' })} />)

    expect(useTableDesignerStore.getState().tabs['tab-1']?.currentSchema.tableName).toBe(
      'draft_users'
    )
  })

  it('sub-tab bar renders 5 tabs', async () => {
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    render(<TableDesignerTab tab={makeTab()} />)

    await waitFor(() => {
      expect(screen.getByTestId('table-designer-subtabs')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Indexes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Foreign Keys' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Table Properties' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DDL Preview' })).toBeInTheDocument()
  })

  it('renders error state when loadError is set', () => {
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          isLoading: false,
          loadError: 'Load failed',
        },
      },
    }))

    render(<TableDesignerTab tab={makeTab()} />)
    expect(screen.getByTestId('table-designer-error')).toHaveTextContent('Load failed')
  })

  it('shows light theme unsaved subtitle in alter mode when dirty', () => {
    useThemeStore.setState({ theme: 'light', resolvedTheme: 'light' })
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          isDirty: true,
          currentSchema: {
            ...state.tabs['tab-1'].currentSchema,
            tableName: 'users',
          },
        },
      },
    }))

    render(<TableDesignerTab tab={makeTab()} />)
    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
  })

  it('clicking the indexes sub-tab shows IndexEditor content', async () => {
    const user = userEvent.setup()
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    render(<TableDesignerTab tab={makeTab()} />)

    await user.click(screen.getByRole('button', { name: 'Indexes' }))

    expect(screen.getByTestId('index-editor')).toBeInTheDocument()
    expect(useTableDesignerStore.getState().tabs['tab-1']?.selectedSubTab).toBe('indexes')
  })

  it('clicking the foreign keys sub-tab shows ForeignKeyEditor content', async () => {
    const user = userEvent.setup()
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    render(<TableDesignerTab tab={makeTab()} />)

    await user.click(screen.getByRole('button', { name: 'Foreign Keys' }))

    expect(screen.getByTestId('foreign-key-editor')).toBeInTheDocument()
    expect(useTableDesignerStore.getState().tabs['tab-1']?.selectedSubTab).toBe('fks')
  })

  it('clicking the table properties sub-tab shows TablePropertiesEditor content', async () => {
    const user = userEvent.setup()
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    render(<TableDesignerTab tab={makeTab()} />)

    await user.click(screen.getByRole('button', { name: 'Table Properties' }))

    expect(screen.getByTestId('table-properties-editor')).toBeInTheDocument()
    expect(useTableDesignerStore.getState().tabs['tab-1']?.selectedSubTab).toBe('properties')
  })

  it('clicking the DDL Preview sub-tab shows DdlPreviewTab content', async () => {
    const user = userEvent.setup()
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    render(<TableDesignerTab tab={makeTab()} />)

    await user.click(screen.getByRole('button', { name: 'DDL Preview' }))

    expect(screen.getByTestId('ddl-preview-tab')).toBeInTheDocument()
    expect(useTableDesignerStore.getState().tabs['tab-1']?.selectedSubTab).toBe('ddl')
  })

  it('clicking Apply Changes opens dialog after regenerate completes', async () => {
    const user = userEvent.setup()
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          isDirty: true,
          ddl: 'ALTER TABLE `users` ...',
        },
      },
    }))

    render(<TableDesignerTab tab={makeTab()} />)
    await user.click(screen.getByTestId('table-designer-apply'))

    await waitFor(() => {
      expect(screen.getByTestId('apply-schema-dialog')).toBeInTheDocument()
    })
    expect(generateTableDdl).toHaveBeenCalled()
  })

  it('successful create apply updates workspace tab context and refreshes schema tree', async () => {
    const user = userEvent.setup()
    const refreshCategory = vi.fn().mockResolvedValue(undefined)
    useSchemaStore.setState({
      connectionStates: {},
      refreshCategory,
    })

    useWorkspaceStore.getState().openTab({
      type: 'table-designer',
      label: '__new_table__',
      connectionId: 'conn-1',
      mode: 'create',
      databaseName: 'app_db',
      objectName: '__new_table__',
    })

    const workspaceTab = useWorkspaceStore.getState().tabsByConnection[
      'conn-1'
    ][0] as TableDesignerTabType
    useTableDesignerStore
      .getState()
      .initTab(workspaceTab.id, 'create', 'conn-1', 'app_db', '__new_table__')
    useTableDesignerStore.getState().updateTableName(workspaceTab.id, 'audit_log')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        [workspaceTab.id]: {
          ...state.tabs[workspaceTab.id],
          isDirty: true,
          ddl: 'CREATE TABLE `audit_log` (...)',
        },
      },
    }))

    render(
      <TableDesignerTab tab={{ ...workspaceTab, mode: 'create', objectName: '__new_table__' }} />
    )

    await user.click(screen.getByTestId('table-designer-apply'))
    await screen.findByTestId('apply-schema-dialog')
    await user.click(screen.getByTestId('apply-schema-confirm'))

    await waitFor(() => {
      const updatedTab = useWorkspaceStore.getState().tabsByConnection[
        'conn-1'
      ][0] as TableDesignerTabType
      expect(updatedTab.mode).toBe('alter')
      expect(updatedTab.objectName).toBe('audit_log')
      expect(updatedTab.label).toBe('audit_log')
    })
    expect(refreshCategory).toHaveBeenCalledWith('conn-1', 'app_db', 'table')
  })

  it('unsaved schema changes dialog supports discard and cancel flows', async () => {
    const user = userEvent.setup()
    const action = vi.fn()
    useTableDesignerStore.getState().initTab('tab-1', 'alter', 'conn-1', 'app_db', 'users')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          isDirty: true,
          pendingNavigationAction: action,
        },
      },
    }))

    const { rerender } = render(<TableDesignerTab tab={makeTab()} />)

    expect(screen.getByText('Unsaved Schema Changes')).toBeInTheDocument()
    await user.click(screen.getByTestId('btn-cancel-changes'))
    await waitFor(() => {
      expect(useTableDesignerStore.getState().tabs['tab-1']?.pendingNavigationAction).toBeNull()
    })

    await act(async () => {
      useTableDesignerStore.setState((state) => ({
        tabs: {
          ...state.tabs,
          'tab-1': {
            ...state.tabs['tab-1'],
            isDirty: true,
            pendingNavigationAction: action,
          },
        },
      }))
      rerender(<TableDesignerTab tab={makeTab()} />)
    })

    await user.click(screen.getByTestId('btn-discard-changes'))
    expect(action).toHaveBeenCalledTimes(1)
  })
})
