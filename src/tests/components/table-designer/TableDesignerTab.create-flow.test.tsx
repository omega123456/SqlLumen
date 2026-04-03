import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TableDesignerTab } from '../../../components/table-designer/TableDesignerTab'
import { useSchemaStore } from '../../../stores/schema-store'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { useThemeStore } from '../../../stores/theme-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { TableDesignerTab as TableDesignerTabType } from '../../../types/schema'

function makeCreateTab(): TableDesignerTabType {
  return {
    id: 'tab-create',
    type: 'table-designer',
    label: '__new_table__',
    connectionId: 'conn-1',
    mode: 'create',
    databaseName: 'app_db',
    objectName: '__new_table__',
  }
}

describe('TableDesignerTab create flow', () => {
  beforeEach(() => {
    useTableDesignerStore.getState().cleanupTab('tab-create')
    useTableDesignerStore.setState({ tabs: {} })
    useWorkspaceStore.setState({ tabsByConnection: {}, activeTabByConnection: {} })
    useSchemaStore.setState({ connectionStates: {} })
    useThemeStore.setState({ theme: 'dark', resolvedTheme: 'dark' })
  })

  it('renders the column editor when opening a new table designer tab', async () => {
    render(<TableDesignerTab tab={makeCreateTab()} />)

    await waitFor(() => {
      expect(useTableDesignerStore.getState().tabs['tab-create']).toBeDefined()
      expect(screen.getByTestId('column-editor')).toBeInTheDocument()
    })

    expect(screen.getByTestId('column-editor-ghost-add')).toBeInTheDocument()
  })
})
