import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResultsSettings } from '../../../components/settings/ResultsSettings'
import { SETTINGS_DEFAULTS, useSettingsStore } from '../../../stores/settings-store'

describe('ResultsSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS },
      pendingChanges: {},
      isDirty: false,
      isLoading: false,
      activeSection: 'results',
    })
  })

  it('renders the results settings defaults', () => {
    render(<ResultsSettings />)

    expect(screen.getByTestId('settings-results')).toBeInTheDocument()
    expect(screen.getByText('Row limit')).toBeInTheDocument()
    expect(screen.getByTestId('settings-page-size')).toHaveValue(500)
    expect(screen.getByTestId('settings-null-display')).toHaveValue('NULL')
  })

  it('uses pending values when present', () => {
    useSettingsStore.setState({
      pendingChanges: {
        'results.pageSize': '250',
        'results.nullDisplay': '<null>',
        'results.cacheTTL': '7200',
      },
      isDirty: true,
    })

    render(<ResultsSettings />)

    expect(screen.getByTestId('settings-page-size')).toHaveValue(250)
    expect(screen.getByTestId('settings-null-display')).toHaveValue('<null>')
    expect(screen.getByTestId('settings-cache-ttl')).toHaveTextContent('2 hours')
  })

  it('updates page size and null display pending changes', async () => {
    const user = userEvent.setup()
    render(<ResultsSettings />)

    const rowLimit = screen.getByTestId('settings-page-size') as HTMLInputElement
    const nullDisplay = screen.getByTestId('settings-null-display') as HTMLInputElement

    await user.clear(rowLimit)
    await user.type(rowLimit, '750')
    await user.clear(nullDisplay)
    await user.type(nullDisplay, '(null)')

    expect(useSettingsStore.getState().pendingChanges['results.pageSize']).toBe('750')
    expect(useSettingsStore.getState().pendingChanges['results.nullDisplay']).toBe('(null)')
  })

  it('renders the result cache section with the default cache duration', () => {
    render(<ResultsSettings />)

    expect(screen.getByText('Result Cache')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Control how long query results and table data are kept in memory before being discarded.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Cache duration')).toBeInTheDocument()
    expect(screen.getByTestId('settings-cache-ttl')).toHaveTextContent('30 minutes')
  })

  it('updates the cache duration pending change from the dropdown', async () => {
    const user = userEvent.setup()
    render(<ResultsSettings />)

    await user.click(screen.getByTestId('settings-cache-ttl'))
    await user.click(screen.getByRole('option', { name: /4 hours/i }))

    expect(useSettingsStore.getState().pendingChanges['results.cacheTTL']).toBe('14400')
    expect(screen.getByTestId('settings-cache-ttl')).toHaveTextContent('4 hours')
  })

  describe('tableTabsInBottomPanel toggle', () => {
    it('renders as unchecked by default when no persisted value', () => {
      useSettingsStore.setState({
        settings: {},
        pendingChanges: {},
        isDirty: false,
      })

      render(<ResultsSettings />)

      const toggle = screen.getByTestId('settings-table-tabs-bottom')
      const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
      expect(checkbox).not.toBeChecked()
    })

    it('renders as checked when pending value is "true"', () => {
      useSettingsStore.setState({
        pendingChanges: {
          'results.tableTabsInBottomPanel': 'true',
        },
        isDirty: true,
      })

      render(<ResultsSettings />)

      const toggle = screen.getByTestId('settings-table-tabs-bottom')
      const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
      expect(checkbox).toBeChecked()
    })

    it('toggling it updates pending settings change', async () => {
      const user = userEvent.setup()
      useSettingsStore.setState({
        settings: {},
        pendingChanges: {},
        isDirty: false,
      })

      render(<ResultsSettings />)

      const toggle = screen.getByTestId('settings-table-tabs-bottom')
      const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement

      await user.click(checkbox)

      expect(useSettingsStore.getState().pendingChanges['results.tableTabsInBottomPanel']).toBe(
        'true'
      )
      expect(useSettingsStore.getState().isDirty).toBe(true)
    })

    it('toggling off sets pending value to "false"', async () => {
      const user = userEvent.setup()
      useSettingsStore.setState({
        settings: { 'results.tableTabsInBottomPanel': 'true' },
        pendingChanges: {},
        isDirty: false,
      })

      render(<ResultsSettings />)

      const toggle = screen.getByTestId('settings-table-tabs-bottom')
      const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement

      await user.click(checkbox)

      expect(useSettingsStore.getState().pendingChanges['results.tableTabsInBottomPanel']).toBe(
        'false'
      )
    })
  })
})
