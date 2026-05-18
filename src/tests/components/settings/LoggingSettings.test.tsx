import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoggingSettings } from '../../../components/settings/LoggingSettings'
import { SETTINGS_DEFAULTS, useSettingsStore } from '../../../stores/settings-store'
import { ipc } from '../../ipc-mock'

describe('LoggingSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS },
      pendingChanges: {},
      isDirty: false,
      isLoading: false,
      activeSection: 'logging',
    })
    // Default: version 1.2.3 with no rust log override
    ipc.override('get_app_info', () => ({
      rustLogOverride: false,
      logDirectory: '/mock/logs',
      appVersion: '1.2.3',
    }))
  })

  it('renders app info and the current log level', async () => {
    render(<LoggingSettings />)

    expect(await screen.findByText('1.2.3')).toBeInTheDocument()
    expect(screen.getByTestId('settings-log-dir')).toHaveTextContent('/mock/logs')
    expect(screen.getByTestId('settings-log-level-dropdown')).toHaveTextContent('Info')
  })

  it('disables the log level dropdown when RUST_LOG overrides settings', async () => {
    ipc.override('get_app_info', () => ({
      rustLogOverride: true,
      logDirectory: '/override/logs',
      appVersion: '2.0.0',
    }))

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
    ipc.override('get_app_info', () => {
      throw new Error('boom')
    })
    render(<LoggingSettings />)

    await waitFor(() => {
      const logCalls = ipc.calls('log_frontend')
      const matched = logCalls.some((call) => {
        const args = call as Record<string, unknown>
        return (
          args.level === 'error' &&
          typeof args.message === 'string' &&
          args.message.includes('[settings] Failed to load app info:')
        )
      })
      expect(matched).toBe(true)
    })

    expect(screen.getAllByText('...')).toHaveLength(2)
    expect(screen.getByTestId('settings-log-dir')).toHaveTextContent('...')
  })

  it('suppresses console.error for expected IPC failures', async () => {
    // Suppress console.error because the IPC throw causes logFrontend to log
    // an "[app-log]" prefix error for the logFrontend invoke failure itself
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ipc.override('get_app_info', () => {
      throw new Error('boom')
    })
    render(<LoggingSettings />)

    await waitFor(() => {
      expect(screen.getAllByText('...')).toHaveLength(2)
    })

    consoleSpy.mockRestore()
  })
})
