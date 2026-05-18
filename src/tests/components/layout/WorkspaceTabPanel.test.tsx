import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkspaceTabPanel } from '../../../components/layout/WorkspaceTabPanel'
import type { WorkspaceTab } from '../../../types/schema'
import styles from '../../../components/layout/WorkspaceTabPanel.module.css'

const baseTab = {
  id: 'tab-1',
  label: 'Tab 1',
  connectionId: 'connection-1',
}

const tabsByRealTestId: Array<[WorkspaceTab, string]> = [
  [
    {
      ...baseTab,
      type: 'table-data',
      databaseName: 'sakila',
      objectName: 'actor',
      objectType: 'table',
    },
    'table-data-tab',
  ],
  [
    {
      ...baseTab,
      type: 'schema-info',
      databaseName: 'sakila',
      objectName: 'actor',
      objectType: 'table',
    },
    'schema-info-tab',
  ],
  [{ ...baseTab, type: 'query-editor' }, 'query-editor-tab'],
  [
    {
      ...baseTab,
      type: 'table-designer',
      mode: 'alter',
      databaseName: 'sakila',
      objectName: 'actor',
    },
    'table-designer-tab',
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
    'object-editor-tab',
  ],
  [{ ...baseTab, type: 'history' }, 'history-tab'],
  [{ ...baseTab, type: 'processlist' }, 'processlist-tab'],
]

describe('WorkspaceTabPanel', () => {
  it.each(tabsByRealTestId)(
    'renders the correct child component for %s',
    async (tab, testId) => {
      render(<WorkspaceTabPanel tab={tab} connectionId="connection-1" sessionId="session-1" />)

      await waitFor(() => {
        expect(screen.getByTestId(testId)).toBeInTheDocument()
      })
    }
  )

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
