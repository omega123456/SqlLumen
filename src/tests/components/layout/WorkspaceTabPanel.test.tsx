import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceTabPanel } from '../../../components/layout/WorkspaceTabPanel'
import type { WorkspaceTab } from '../../../types/schema'
import styles from '../../../components/layout/WorkspaceTabPanel.module.css'

vi.mock('../../../components/table-data/TableDataTab', () => ({
  TableDataTab: () => <div data-testid="mock-table-data" />,
}))

vi.mock('../../../components/schema-info/SchemaInfoTab', () => ({
  SchemaInfoTab: () => <div data-testid="mock-schema-info" />,
}))

vi.mock('../../../components/query-editor/QueryEditorTab', () => ({
  QueryEditorTab: () => <div data-testid="mock-query-editor" />,
}))

vi.mock('../../../components/table-designer/TableDesignerTab', () => ({
  TableDesignerTab: () => <div data-testid="mock-table-designer" />,
}))

vi.mock('../../../components/object-editor/ObjectEditorTab', () => ({
  ObjectEditorTab: () => <div data-testid="mock-object-editor" />,
}))

vi.mock('../../../components/history/HistoryTab', () => ({
  HistoryTab: () => <div data-testid="mock-history" />,
}))

vi.mock('../../../components/processlist/ProcessListTab', () => ({
  default: () => <div data-testid="mock-processlist" />,
}))

const baseTab = {
  id: 'tab-1',
  label: 'Tab 1',
  connectionId: 'connection-1',
}

const tabsByMockTestId: Array<[WorkspaceTab, string]> = [
  [
    {
      ...baseTab,
      type: 'table-data',
      databaseName: 'sakila',
      objectName: 'actor',
      objectType: 'table',
    },
    'mock-table-data',
  ],
  [
    {
      ...baseTab,
      type: 'schema-info',
      databaseName: 'sakila',
      objectName: 'actor',
      objectType: 'table',
    },
    'mock-schema-info',
  ],
  [{ ...baseTab, type: 'query-editor' }, 'mock-query-editor'],
  [
    {
      ...baseTab,
      type: 'table-designer',
      mode: 'alter',
      databaseName: 'sakila',
      objectName: 'actor',
    },
    'mock-table-designer',
  ],
  [
    {
      ...baseTab,
      type: 'object-editor',
      databaseName: 'sakila',
      objectName: 'active_actor',
      objectType: 'view',
      mode: 'alter',
    },
    'mock-object-editor',
  ],
  [{ ...baseTab, type: 'history' }, 'mock-history'],
  [{ ...baseTab, type: 'processlist' }, 'mock-processlist'],
]

describe('WorkspaceTabPanel', () => {
  it.each(tabsByMockTestId)('renders the correct child component for %s', (tab, testId) => {
    render(<WorkspaceTabPanel tab={tab} connectionId="connection-1" sessionId="session-1" />)

    expect(screen.getByTestId(testId)).toBeInTheDocument()
  })

  it('marks an active panel as active and visible', () => {
    render(
      <WorkspaceTabPanel
        tab={{ ...baseTab, type: 'query-editor' }}
        isActive={true}
        connectionId="connection-1"
      />
    )

    const panel = screen.getByTestId('workspace-panel')
    expect(panel).toHaveAttribute('data-active', 'true')
    expect(panel).not.toHaveAttribute('aria-hidden')
    expect(panel).toBeVisible()
  })

  it('marks an inactive panel as inactive and hidden from accessibility', () => {
    render(
      <WorkspaceTabPanel
        tab={{ ...baseTab, type: 'query-editor' }}
        isActive={false}
        connectionId="connection-1"
      />
    )

    const panel = screen.getByTestId('workspace-panel')
    expect(panel).toHaveAttribute('data-active', 'false')
    expect(panel).toHaveAttribute('aria-hidden', 'true')
    expect(panel).toHaveClass(styles.inactive)
  })

  it('defaults to active for backwards compatibility', () => {
    render(
      <WorkspaceTabPanel tab={{ ...baseTab, type: 'query-editor' }} connectionId="connection-1" />
    )

    const panel = screen.getByTestId('workspace-panel')
    expect(panel).toHaveAttribute('data-active', 'true')
    expect(panel).not.toHaveAttribute('aria-hidden')
  })
})
