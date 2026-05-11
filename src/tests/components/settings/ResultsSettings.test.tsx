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
    expect(screen.getByTestId('settings-page-size')).toHaveValue(500)
    expect(screen.getByTestId('settings-null-display')).toHaveValue('NULL')
  })

  it('uses pending values when present', () => {
    useSettingsStore.setState({
      pendingChanges: {
        'results.pageSize': '250',
        'results.nullDisplay': '<null>',
      },
      isDirty: true,
    })

    render(<ResultsSettings />)

    expect(screen.getByTestId('settings-page-size')).toHaveValue(250)
    expect(screen.getByTestId('settings-null-display')).toHaveValue('<null>')
  })

  it('updates page size and null display pending changes', async () => {
    const user = userEvent.setup()
    render(<ResultsSettings />)

    const pageSize = screen.getByTestId('settings-page-size') as HTMLInputElement
    const nullDisplay = screen.getByTestId('settings-null-display') as HTMLInputElement

    await user.clear(pageSize)
    await user.type(pageSize, '750')
    await user.clear(nullDisplay)
    await user.type(nullDisplay, '(null)')

    expect(useSettingsStore.getState().pendingChanges['results.pageSize']).toBe('750')
    expect(useSettingsStore.getState().pendingChanges['results.nullDisplay']).toBe('(null)')
  })
})
