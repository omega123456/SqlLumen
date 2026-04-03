import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TablePropertiesEditor } from '../../../components/table-designer/TablePropertiesEditor'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import type { TableDesignerTabState } from '../../../stores/table-designer-store'

vi.mock('../../../lib/table-designer-commands', () => ({
  loadTableForDesigner: vi.fn().mockResolvedValue(undefined),
  generateTableDdl: vi.fn().mockResolvedValue({ ddl: 'ALTER TABLE `users` ...', warnings: [] }),
  applyTableDdl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../lib/schema-commands', () => ({
  listCharsets: vi.fn(),
  listCollations: vi.fn(),
}))

import { listCharsets, listCollations } from '../../../lib/schema-commands'

const mockListCharsets = vi.mocked(listCharsets)
const mockListCollations = vi.mocked(listCollations)

function makeTabState(overrides: Partial<TableDesignerTabState> = {}): TableDesignerTabState {
  return {
    connectionId: 'conn-1',
    databaseName: 'app_db',
    objectName: 'users',
    mode: 'alter',
    originalSchema: null,
    currentSchema: {
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
    selectedSubTab: 'properties',
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

describe('TablePropertiesEditor', () => {
  beforeEach(() => {
    useTableDesignerStore.getState().cleanupTab('tab-1')
    useTableDesignerStore.setState({ tabs: {} })
    vi.restoreAllMocks()

    mockListCharsets.mockResolvedValue([
      {
        charset: 'utf8mb4',
        description: 'UTF-8 Unicode',
        defaultCollation: 'utf8mb4_unicode_ci',
        maxLength: 4,
      },
      {
        charset: 'latin1',
        description: 'cp1252 West European',
        defaultCollation: 'latin1_swedish_ci',
        maxLength: 1,
      },
    ])

    mockListCollations.mockResolvedValue([
      { name: 'utf8mb4_unicode_ci', charset: 'utf8mb4', isDefault: true },
      { name: 'utf8mb4_general_ci', charset: 'utf8mb4', isDefault: false },
      { name: 'latin1_swedish_ci', charset: 'latin1', isDefault: true },
    ])
  })

  it('renders engine dropdown with InnoDB selected by default', () => {
    seedStore()
    render(<TablePropertiesEditor tabId="tab-1" connectionId="conn-1" databaseName="app_db" />)

    expect(screen.getByTestId('table-properties-engine')).toHaveValue('InnoDB')
  })

  it('engine dropdown change calls store.updateProperties', async () => {
    const user = userEvent.setup()
    seedStore()
    const updatePropertiesSpy = vi.spyOn(useTableDesignerStore.getState(), 'updateProperties')

    render(<TablePropertiesEditor tabId="tab-1" connectionId="conn-1" databaseName="app_db" />)

    await user.selectOptions(screen.getByTestId('table-properties-engine'), 'MyISAM')

    expect(updatePropertiesSpy).toHaveBeenCalledWith('tab-1', 'engine', 'MyISAM')
  })

  it('comment textarea change calls store.updateProperties', async () => {
    const user = userEvent.setup()
    seedStore()
    const updatePropertiesSpy = vi.spyOn(useTableDesignerStore.getState(), 'updateProperties')

    render(<TablePropertiesEditor tabId="tab-1" connectionId="conn-1" databaseName="app_db" />)

    await user.type(screen.getByTestId('table-properties-comment'), 'User accounts table')

    expect(updatePropertiesSpy).toHaveBeenLastCalledWith('tab-1', 'comment', 'User accounts table')
  })

  it('charset dropdown loads from mocked listCharsets', async () => {
    seedStore()

    render(<TablePropertiesEditor tabId="tab-1" connectionId="conn-1" databaseName="app_db" />)

    await waitFor(() => {
      expect(mockListCharsets).toHaveBeenCalledWith('conn-1')
    })

    expect(await screen.findByRole('option', { name: 'utf8mb4' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'latin1' })).toBeInTheDocument()
  })

  it('collation dropdown loads from mocked listCollations filtered by charset', async () => {
    seedStore()

    render(<TablePropertiesEditor tabId="tab-1" connectionId="conn-1" databaseName="app_db" />)

    const collationSelect = await screen.findByTestId('table-properties-collation')

    await waitFor(() => {
      expect(mockListCollations).toHaveBeenCalledWith('conn-1')
    })

    expect(collationSelect).toHaveTextContent('utf8mb4_unicode_ci')
    expect(collationSelect).toHaveTextContent('utf8mb4_general_ci')
    expect(collationSelect).not.toHaveTextContent('latin1_swedish_ci')
  })

  it('collation dropdown reloads when charset changes', async () => {
    const user = userEvent.setup()
    seedStore()

    render(<TablePropertiesEditor tabId="tab-1" connectionId="conn-1" databaseName="app_db" />)

    await screen.findByRole('option', { name: 'utf8mb4' })
    await user.selectOptions(screen.getByTestId('table-properties-charset'), 'latin1')

    await waitFor(() => {
      expect(mockListCollations).toHaveBeenCalled()
    })

    const collationSelect = screen.getByTestId('table-properties-collation')
    await waitFor(() => {
      expect(collationSelect).toHaveValue('latin1_swedish_ci')
    })
    expect(collationSelect).toHaveTextContent('latin1_swedish_ci')
    expect(collationSelect).not.toHaveTextContent('utf8mb4_general_ci')
  })

  it('auto increment input calls store.updateProperties', async () => {
    seedStore()
    const updatePropertiesSpy = vi.spyOn(useTableDesignerStore.getState(), 'updateProperties')

    render(<TablePropertiesEditor tabId="tab-1" connectionId="conn-1" databaseName="app_db" />)

    const input = screen.getByTestId('table-properties-auto-increment')
    fireEvent.change(input, { target: { value: '42' } })

    expect(updatePropertiesSpy).toHaveBeenLastCalledWith('tab-1', 'autoIncrement', 42)
  })

  it('row format dropdown calls store.updateProperties', async () => {
    const user = userEvent.setup()
    seedStore()
    const updatePropertiesSpy = vi.spyOn(useTableDesignerStore.getState(), 'updateProperties')

    render(<TablePropertiesEditor tabId="tab-1" connectionId="conn-1" databaseName="app_db" />)

    await user.selectOptions(screen.getByTestId('table-properties-row-format'), 'COMPACT')

    expect(updatePropertiesSpy).toHaveBeenCalledWith('tab-1', 'rowFormat', 'COMPACT')
  })
})
