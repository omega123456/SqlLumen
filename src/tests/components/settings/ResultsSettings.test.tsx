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
      validationErrors: {},
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

  it('renders the maximum rows field with helper text for both fields', () => {
    render(<ResultsSettings />)
    const maxRows = screen.getByTestId('settings-max-rows')
    expect(screen.getByLabelText('Maximum rows kept per result')).toBe(maxRows)
    expect(maxRows).toHaveValue(100000)
    expect(maxRows).toHaveAttribute('aria-describedby', 'settings-max-rows-help')
    expect(maxRows).toHaveAttribute('aria-invalid', 'false')
    expect(
      screen.getByText(
        "Adds a LIMIT to SELECT queries that don't have one. Capped by the maximum below."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Upper bound for any result, including queries with their own LIMIT or CALL. Results that reach it are marked truncated. Applies to queries run after you save.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByTestId('settings-page-size-capped')).not.toBeInTheDocument()
  })

  it('validates on blur only and shows the inline error with aria-invalid and aria-describedby', async () => {
    const user = userEvent.setup()
    render(<ResultsSettings />)
    const maxRows = screen.getByTestId('settings-max-rows')

    await user.clear(maxRows)
    await user.type(maxRows, '500')
    expect(screen.queryByTestId('settings-max-rows-error')).not.toBeInTheDocument()

    await user.tab()
    const error = screen.getByTestId('settings-max-rows-error')
    expect(error).toHaveTextContent('Enter a whole number from 1,000 to 1,000,000.')
    expect(maxRows).toHaveAttribute('aria-invalid', 'true')
    expect(maxRows).toHaveAttribute(
      'aria-describedby',
      'settings-max-rows-help settings-max-rows-error'
    )
    // Never silently clamped.
    expect(useSettingsStore.getState().pendingChanges['results.maxRows']).toBe('500')

    await user.clear(maxRows)
    await user.type(maxRows, '2000')
    await user.tab()
    expect(screen.queryByTestId('settings-max-rows-error')).not.toBeInTheDocument()
  })

  it('notes when the row limit exceeds the maximum rows kept per result', () => {
    useSettingsStore.setState({
      pendingChanges: { 'results.pageSize': '5000', 'results.maxRows': '1000' },
      isDirty: true,
    })
    render(<ResultsSettings />)
    expect(screen.getByTestId('settings-page-size-capped')).toHaveTextContent(
      'Limited to the maximum rows kept per result (1,000).'
    )
  })

  it('renders the result cache section with the default cache duration', () => {
    render(<ResultsSettings />)

    expect(screen.getByText('Result cache')).toBeInTheDocument()
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

  it('defaults max open tabs per group to Unlimited and updates the pending change', async () => {
    const user = userEvent.setup()
    render(<ResultsSettings />)

    expect(screen.getByTestId('settings-max-tabs-per-group')).toHaveTextContent('Unlimited')

    await user.click(screen.getByTestId('settings-max-tabs-per-group'))
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Unlimited')
    await user.click(screen.getByRole('option', { name: '10' }))

    expect(useSettingsStore.getState().pendingChanges['results.maxTabsPerGroup']).toBe('10')
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
