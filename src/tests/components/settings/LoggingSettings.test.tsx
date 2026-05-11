import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockGetAppInfo, mockLogFrontend } = vi.hoisted(() => ({
  mockGetAppInfo: vi.fn(),
  mockLogFrontend: vi.fn(),
}))

vi.mock('../../../lib/app-info-commands', () => ({
  getAppInfo: mockGetAppInfo,
}))

vi.mock('../../../lib/app-log-commands', () => ({
  logFrontend: mockLogFrontend,
}))

import { LoggingSettings } from '../../../components/settings/LoggingSettings'
import { SETTINGS_DEFAULTS, useSettingsStore } from '../../../stores/settings-store'

describe('LoggingSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS },
      pendingChanges: {},
      isDirty: false,
      isLoading: false,
      activeSection: 'logging',
    })
    mockGetAppInfo.mockReset().mockResolvedValue({
      rustLogOverride: false,
      logDirectory: '/mock/logs',
      appVersion: '1.2.3',
    })
    mockLogFrontend.mockReset()
  })

  it('renders app info and the current log level', async () => {
    render(<LoggingSettings />)

    expect(await screen.findByText('1.2.3')).toBeInTheDocument()
    expect(screen.getByTestId('settings-log-dir')).toHaveTextContent('/mock/logs')
    expect(screen.getByTestId('settings-log-level-dropdown')).toHaveTextContent('Info')
  })

  it('disables the log level dropdown when RUST_LOG overrides settings', async () => {
    mockGetAppInfo.mockResolvedValue({
      rustLogOverride: true,
      logDirectory: '/override/logs',
      appVersion: '2.0.0',
    })

    render(<LoggingSettings />)

    expect(await screen.findByTestId('settings-rust-log-override')).toBeInTheDocument()
    expect(screen.getByTestId('settings-log-level-dropdown')).toBeDisabled()
    expect(screen.getByTestId('settings-log-dir')).toHaveTextContent('/override/logs')
  })

  it('updates the pending log level when a new option is selected', async () => {
    const user = userEvent.setup()
    render(<LoggingSettings />)

    await screen.findByText('1.2.3')
    await user.click(screen.getByTestId('settings-log-level-dropdown'))
    await user.click(screen.getByTestId('settings-log-level-dropdown-option-debug'))

    expect(useSettingsStore.getState().pendingChanges['log.level']).toBe('debug')
  })

  it('keeps placeholders and logs when app info loading fails', async () => {
    mockGetAppInfo.mockRejectedValue(new Error('boom'))
    render(<LoggingSettings />)

    await waitFor(() => {
      expect(mockLogFrontend).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('[settings] Failed to load app info:')
      )
    })

    expect(screen.getAllByText('...')).toHaveLength(2)
    expect(screen.getByTestId('settings-log-dir')).toHaveTextContent('...')
  })
})
