import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { SettingsDialog } from '../../../components/settings/SettingsDialog'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'
import { useShortcutStore } from '../../../stores/shortcut-store'
import { useThemeStore } from '../../../stores/theme-store'

/** `settings-general` mounts before `loadSettings()` finishes; wait for IPC-backed store hydration. */
async function waitForSettingsHydrated() {
  await waitFor(() => {
    const s = useSettingsStore.getState()
    expect(Object.keys(s.settings).length).toBeGreaterThan(0)
    expect(s.isLoading).toBe(false)
  })
}

function setupMockIPC() {
  mockIPC((cmd, args) => {
    if (cmd === 'get_all_settings') return { ...SETTINGS_DEFAULTS }
    if (cmd === 'set_setting') return null
    if (cmd === 'get_app_info')
      return { rustLogOverride: false, logDirectory: '/mock/logs', appVersion: '1.0.0' }
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd} ${JSON.stringify(args)}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useSettingsStore.setState({
    settings: {},
    pendingChanges: {},
    isDirty: false,
    isLoading: false,
    activeSection: 'general',
  })
  useShortcutStore.getState().resetAllShortcuts()
  useThemeStore.setState({ theme: 'light', resolvedTheme: 'light', _previewSnapshot: null })
  document.documentElement.removeAttribute('data-theme')
  setupMockIPC()
})

describe('SettingsDialog', () => {
  it('renders nothing when isOpen is false', () => {
    render(<SettingsDialog isOpen={false} onClose={vi.fn()} />)
    expect(screen.queryByTestId('settings-dialog')).not.toBeInTheDocument()
  })

  it('renders the dialog with sidebar and content when open', async () => {
    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)
    await waitForSettingsHydrated()
    await waitFor(() => {
      expect(screen.getByTestId('settings-dialog')).toBeInTheDocument()
    })
    expect(screen.getByTestId('settings-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('settings-content')).toBeInTheDocument()
    expect(screen.getByTestId('settings-save')).toBeInTheDocument()
    expect(screen.getByTestId('settings-cancel')).toBeInTheDocument()
    expect(screen.getByTestId('settings-reset-section')).toBeInTheDocument()
  })

  it('shows General section by default', async () => {
    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)
    await waitForSettingsHydrated()
    expect(screen.getByTestId('settings-general')).toBeInTheDocument()
  })

  it('navigates between sections via sidebar', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)
    await waitForSettingsHydrated()

    // Switch to Editor
    await user.click(screen.getByTestId('settings-nav-editor'))
    expect(screen.getByTestId('settings-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-general')).not.toBeInTheDocument()

    // Switch to Results
    await user.click(screen.getByTestId('settings-nav-results'))
    expect(screen.getByTestId('settings-results')).toBeInTheDocument()

    // Switch to Logging
    await user.click(screen.getByTestId('settings-nav-logging'))
    await waitFor(() => {
      expect(screen.getByTestId('settings-logging')).toBeInTheDocument()
    })

    // Switch to Shortcuts
    await user.click(screen.getByTestId('settings-nav-shortcuts'))
    expect(screen.getByTestId('settings-shortcuts')).toBeInTheDocument()
  })

  it('Save button is disabled when not dirty', async () => {
    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)
    await waitForSettingsHydrated()
    await waitFor(() => {
      expect(screen.getByTestId('settings-save')).toBeInTheDocument()
    })
    expect(screen.getByTestId('settings-save')).toBeDisabled()
  })

  it('Cancel calls onClose when not dirty', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SettingsDialog isOpen={true} onClose={onClose} />)
    await waitForSettingsHydrated()
    await waitFor(() => {
      expect(screen.getByTestId('settings-cancel')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('settings-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Cancel shows confirm dialog when dirty', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<SettingsDialog isOpen={true} onClose={onClose} />)
    await waitForSettingsHydrated()

    // Make dirty by changing a setting
    await act(() => {
      useSettingsStore.setState({ isDirty: true, pendingChanges: { theme: 'dark' } })
    })

    await user.click(screen.getByTestId('settings-cancel'))
    // Should show confirm dialog instead of closing
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    })
    expect(screen.getByText('Discard Changes')).toBeInTheDocument()
  })

  it('Discard confirmation discards changes and closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<SettingsDialog isOpen={true} onClose={onClose} />)
    await waitForSettingsHydrated()

    // Make dirty
    await act(() => {
      useSettingsStore.setState({ isDirty: true, pendingChanges: { theme: 'dark' } })
    })

    await user.click(screen.getByTestId('settings-cancel'))
    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    })

    // Confirm discard
    await user.click(screen.getByTestId('confirm-confirm-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(useSettingsStore.getState().isDirty).toBe(false)
  })

  it('Reset Section resets the active section to defaults', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)
    await waitForSettingsHydrated()

    await user.click(screen.getByTestId('settings-reset-section'))
    // After reset, pending changes should have default values for general keys
    const state = useSettingsStore.getState()
    expect(state.pendingChanges['theme']).toBe('system')
    expect(state.pendingChanges['session.restore']).toBe('true')
  })

  it('loads settings on open', async () => {
    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)
    await waitForSettingsHydrated()
  })

  it('checkbox can be toggled on then off without losing reactivity', async () => {
    // Regression test for: toggling a checkbox ON works, but toggling it OFF
    // left the checkbox stuck because the Zustand selector returned a stable
    // function reference (s.getSetting) instead of the computed value.
    const user = userEvent.setup()
    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)
    await waitForSettingsHydrated()

    // Navigate to Editor section which has boolean toggles defaulting to false
    await user.click(screen.getByTestId('settings-nav-editor'))
    await waitFor(() => {
      expect(screen.getByTestId('settings-editor')).toBeInTheDocument()
    })

    // Find the "Word wrap" checkbox (defaults to false/unchecked)
    const wordWrapToggle = screen.getByTestId('settings-word-wrap')
    const checkbox = wordWrapToggle.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.checked).toBe(false)

    // Toggle ON
    await user.click(checkbox)
    expect(checkbox.checked).toBe(true)

    // Toggle OFF — this was the broken path
    await user.click(checkbox)
    expect(checkbox.checked).toBe(false)

    // Verify store state matches
    expect(useSettingsStore.getState().pendingChanges['editor.wordWrap']).toBe('false')
  })
})
