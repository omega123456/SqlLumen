import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { AppBody } from '../../../components/layout/AppBody'
import { useConnectionStore } from '../../../stores/connection-store'
import { useConnectionsPageStore } from '../../../stores/connections-page-store'
import { useSessionRestoreStore } from '../../../stores/session-restore-store'
import {
  makeActiveConnection,
  markSessionRestoreSettled,
} from '../../helpers/connection-test-utils'

beforeEach(() => {
  useSessionRestoreStore.setState({ isRestoring: false, hasRestoreSettled: false })
  useConnectionsPageStore.getState().closePage()
  useConnectionStore.setState({
    activeConnections: {},
    activeConnectionOrder: [],
    activeTabId: null,
  })
})

describe('AppBody', () => {
  it('shows an empty surface until session restore settles, then the connections page', async () => {
    render(<AppBody />)
    expect(screen.getByTestId('app-body-pending')).toBeInTheDocument()
    expect(screen.queryByTestId('connections-page')).not.toBeInTheDocument()

    act(() => markSessionRestoreSettled())
    expect(await screen.findByRole('heading', { name: 'Connections' })).toBeInTheDocument()
  })

  it('keeps the workspace mounted but hidden while the page covers open sessions', async () => {
    markSessionRestoreSettled()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection() },
      activeConnectionOrder: ['conn-1'],
      activeTabId: 'conn-1',
    })
    render(<AppBody />)
    expect(screen.getByTestId('main-panels')).not.toHaveAttribute('aria-hidden')
    expect(screen.queryByTestId('connections-page')).not.toBeInTheDocument()

    act(() => useConnectionsPageStore.getState().openPage())
    expect(await screen.findByTestId('connections-page')).toBeInTheDocument()
    expect(screen.getByTestId('main-panels')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Back to Test DB' })).toBeInTheDocument()
  })
})
