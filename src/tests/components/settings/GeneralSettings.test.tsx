import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeneralSettings } from '../../../components/settings/GeneralSettings'
import { SETTINGS_DEFAULTS, useSettingsStore } from '../../../stores/settings-store'
import { useThemeStore } from '../../../stores/theme-store'
import { useZoomStore, ZOOM_LEVELS } from '../../../stores/zoom-store'

describe('GeneralSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS },
      pendingChanges: {},
      isDirty: false,
      isLoading: false,
      activeSection: 'general',
    })
    useThemeStore.setState({ theme: 'system', resolvedTheme: 'light', _previewSnapshot: null })
    useZoomStore.setState({ zoomLevel: 100, previewSnapshot: null })
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.zoom = ''
  })

  it('renders the general settings defaults', () => {
    render(<GeneralSettings />)

    expect(screen.getByTestId('settings-general')).toBeInTheDocument()
    expect(screen.getByTestId('settings-theme-dropdown')).toHaveTextContent('System')
    expect(screen.getByTestId('settings-session-restore').querySelector('input')).toBeChecked()
    expect(screen.getByTestId('settings-connection-timeout')).toHaveValue(10)
    expect(screen.getByTestId('settings-keepalive')).toHaveValue(60)
  })

  it('uses pending values when present', () => {
    useSettingsStore.setState({
      pendingChanges: {
        theme: 'dark',
        'session.restore': 'false',
        'connection.defaultTimeout': '25',
        'connection.defaultKeepalive': '120',
      },
      isDirty: true,
    })

    render(<GeneralSettings />)

    expect(screen.getByTestId('settings-theme-dropdown')).toHaveTextContent('Dark')
    expect(screen.getByTestId('settings-session-restore').querySelector('input')).not.toBeChecked()
    expect(screen.getByTestId('settings-connection-timeout')).toHaveValue(25)
    expect(screen.getByTestId('settings-keepalive')).toHaveValue(120)
  })

  it('updates theme pending state and previews the selected theme', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)

    await user.click(screen.getByTestId('settings-theme-dropdown'))
    await user.click(screen.getByTestId('settings-theme-dropdown-option-dark'))

    expect(useSettingsStore.getState().pendingChanges.theme).toBe('dark')
    expect(useThemeStore.getState().theme).toBe('system')
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(useThemeStore.getState()._previewSnapshot).toBe('system')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('updates the session restore toggle and numeric defaults', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)

    const sessionRestore = screen
      .getByTestId('settings-session-restore')
      .querySelector('input') as HTMLInputElement
    const connectionTimeout = screen.getByTestId('settings-connection-timeout') as HTMLInputElement
    const keepalive = screen.getByTestId('settings-keepalive') as HTMLInputElement

    await user.click(sessionRestore)
    await user.clear(connectionTimeout)
    await user.type(connectionTimeout, '30')
    await user.clear(keepalive)
    await user.type(keepalive, '90')

    expect(useSettingsStore.getState().pendingChanges['session.restore']).toBe('false')
    expect(useSettingsStore.getState().pendingChanges['connection.defaultTimeout']).toBe('30')
    expect(useSettingsStore.getState().pendingChanges['connection.defaultKeepalive']).toBe('90')
  })

  it('renders the zoom dropdown with all 9 options', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)

    const zoomDropdown = screen.getByTestId('settings-zoom-dropdown')
    expect(zoomDropdown).toHaveTextContent('100% (Default)')

    await user.click(zoomDropdown)

    const expectedLabels = [
      '70%',
      '80%',
      '90%',
      '100% (Default)',
      '110%',
      '125%',
      '150%',
      '175%',
      '200%',
    ]
    for (const label of expectedLabels) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('option')).toHaveLength(ZOOM_LEVELS.length)
  })

  it('changing zoom calls setPendingChange and previewZoom', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)

    await user.click(screen.getByTestId('settings-zoom-dropdown'))
    await user.click(screen.getByTestId('settings-zoom-dropdown-option-125'))

    expect(useSettingsStore.getState().pendingChanges['appearance.zoom']).toBe('125')
    expect(useZoomStore.getState().zoomLevel).toBe(125)
    expect(useZoomStore.getState().previewSnapshot).toBe(100)
  })

  it('renders snapshot frequency and keep dropdowns with current values', () => {
    render(<GeneralSettings />)

    expect(screen.getByTestId('settings-snapshot-frequency-dropdown')).toHaveTextContent('Daily')
    expect(screen.getByTestId('settings-snapshot-keep-dropdown')).toHaveTextContent('10')
  })

  it('changing snapshot frequency dispatches setPendingChange', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)

    await user.click(screen.getByTestId('settings-snapshot-frequency-dropdown'))
    await user.click(screen.getByTestId('settings-snapshot-frequency-dropdown-option-weekly'))

    expect(useSettingsStore.getState().pendingChanges['snapshots.frequency']).toBe('weekly')
  })

  it('changing snapshots to keep dispatches setPendingChange', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)

    await user.click(screen.getByTestId('settings-snapshot-keep-dropdown'))
    await user.click(screen.getByTestId('settings-snapshot-keep-dropdown-option-50'))

    expect(useSettingsStore.getState().pendingChanges['snapshots.keep']).toBe('50')
  })

  it('shows the current effective zoom value from settings', () => {
    useSettingsStore.setState({
      pendingChanges: { 'appearance.zoom': '150' },
      isDirty: true,
    })

    render(<GeneralSettings />)

    expect(screen.getByTestId('settings-zoom-dropdown')).toHaveTextContent('150%')
  })
})
