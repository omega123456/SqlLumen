import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DdlPreviewTab } from '../../../components/table-designer/DdlPreviewTab'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import type { TableDesignerTabState } from '../../../stores/table-designer-store'

const mockWriteClipboardText = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../lib/context-menu-utils', () => ({
  writeClipboardText: (...args: unknown[]) => mockWriteClipboardText(...args),
}))

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
    ddl: "CREATE TABLE `users` (\n  `id` BIGINT NOT NULL AUTO_INCREMENT,\n  `name` VARCHAR(255) NOT NULL DEFAULT 'guest',\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
    ddlWarnings: [],
    isDdlLoading: false,
    ddlError: null,
    validationErrors: {},
    pendingNavigationAction: null,
    selectedSubTab: 'ddl',
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

describe('DdlPreviewTab', () => {
  beforeEach(() => {
    useTableDesignerStore.getState().cleanupTab('tab-1')
    useTableDesignerStore.setState({ tabs: {} })
    vi.clearAllMocks()
  })

  it('renders DDL string from store', () => {
    seedStore()
    render(<DdlPreviewTab tabId="tab-1" />)

    expect(screen.getByTestId('ddl-preview-code')).toHaveTextContent('CREATE TABLE `users`')
  })

  it('shows Generating state when isDdlLoading is true', () => {
    seedStore({ isDdlLoading: true })
    render(<DdlPreviewTab tabId="tab-1" />)

    expect(screen.getByTestId('ddl-preview-loading')).toHaveTextContent('Generating...')
  })

  it('shows error message when ddlError is set', () => {
    seedStore({ ddlError: 'Failed to generate DDL' })
    render(<DdlPreviewTab tabId="tab-1" />)

    expect(screen.getByTestId('ddl-preview-error')).toHaveTextContent('Failed to generate DDL')
  })

  it('Copy button writes ddl to clipboard', async () => {
    seedStore()
    render(<DdlPreviewTab tabId="tab-1" />)

    const copyButton = screen.getByTestId('ddl-preview-copy')
    expect(copyButton).toBeEnabled()

    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(mockWriteClipboardText).toHaveBeenCalledWith(makeTabState().ddl)
    })
  })

  it('applies syntax highlighting — keywords have .keyword class', () => {
    seedStore()
    render(<DdlPreviewTab tabId="tab-1" />)

    const createKeyword = screen.getByText('CREATE')
    expect(createKeyword).toHaveClass('keyword')
  })

  it('applies syntax highlighting — identifiers have .identifier class', () => {
    seedStore()
    render(<DdlPreviewTab tabId="tab-1" />)

    const identifier = screen.getAllByText('`users`')[0]
    expect(identifier).toHaveClass('identifier')
  })
})
