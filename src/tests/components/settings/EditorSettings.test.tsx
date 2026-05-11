import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorSettings } from '../../../components/settings/EditorSettings'
import { SETTINGS_DEFAULTS, useSettingsStore } from '../../../stores/settings-store'

describe('EditorSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS },
      pendingChanges: {},
      isDirty: false,
      isLoading: false,
      activeSection: 'editor',
    })
  })

  it('renders the editor settings defaults', () => {
    render(<EditorSettings />)

    expect(screen.getByTestId('settings-editor')).toBeInTheDocument()
    expect(screen.getByTestId('settings-font-family-dropdown')).toHaveTextContent('JetBrains Mono')
    expect(screen.getByTestId('settings-font-size')).toHaveValue(14)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '1.6')
    expect(screen.getByTestId('settings-word-wrap').querySelector('input')).not.toBeChecked()
    expect(screen.getByTestId('settings-minimap').querySelector('input')).not.toBeChecked()
    expect(screen.getByTestId('settings-line-numbers').querySelector('input')).toBeChecked()
    expect(
      screen.getByTestId('settings-autocomplete-backticks').querySelector('input')
    ).not.toBeChecked()
  })

  it('uses pending values when present', () => {
    useSettingsStore.setState({
      pendingChanges: {
        'editor.fontFamily': 'Fira Code',
        'editor.fontSize': '18',
        'editor.lineHeight': '2.1',
        'editor.wordWrap': 'true',
        'editor.minimap': 'true',
        'editor.lineNumbers': 'false',
        'editor.autocompleteBackticks': 'true',
      },
      isDirty: true,
    })

    render(<EditorSettings />)

    expect(screen.getByTestId('settings-font-family-dropdown')).toHaveTextContent('Fira Code')
    expect(screen.getByTestId('settings-font-size')).toHaveValue(18)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '2.1')
    expect(screen.getByTestId('settings-word-wrap').querySelector('input')).toBeChecked()
    expect(screen.getByTestId('settings-minimap').querySelector('input')).toBeChecked()
    expect(screen.getByTestId('settings-line-numbers').querySelector('input')).not.toBeChecked()
    expect(screen.getByTestId('settings-autocomplete-backticks').querySelector('input')).toBeChecked()
  })

  it('updates font family, font size, and line height', async () => {
    const user = userEvent.setup()
    render(<EditorSettings />)

    await user.click(screen.getByTestId('settings-font-family-dropdown'))
    await user.click(screen.getByTestId('settings-font-family-dropdown-option-Fira Code'))

    const fontSize = screen.getByTestId('settings-font-size') as HTMLInputElement
    await user.clear(fontSize)
    await user.type(fontSize, '16')

    fireEvent.change(screen.getByRole('slider'), { target: { value: '2.2' } })

    expect(useSettingsStore.getState().pendingChanges['editor.fontFamily']).toBe('Fira Code')
    expect(useSettingsStore.getState().pendingChanges['editor.fontSize']).toBe('16')
    expect(useSettingsStore.getState().pendingChanges['editor.lineHeight']).toBe('2.2')
  })

  it('updates editor behavior toggles', async () => {
    const user = userEvent.setup()
    render(<EditorSettings />)

    const wordWrap = screen.getByTestId('settings-word-wrap').querySelector(
      'input'
    ) as HTMLInputElement
    const minimap = screen.getByTestId('settings-minimap').querySelector('input') as HTMLInputElement
    const lineNumbers = screen.getByTestId('settings-line-numbers').querySelector(
      'input'
    ) as HTMLInputElement
    const autocompleteBackticks = screen
      .getByTestId('settings-autocomplete-backticks')
      .querySelector('input') as HTMLInputElement

    await user.click(wordWrap)
    await user.click(minimap)
    await user.click(lineNumbers)
    await user.click(autocompleteBackticks)

    expect(useSettingsStore.getState().pendingChanges['editor.wordWrap']).toBe('true')
    expect(useSettingsStore.getState().pendingChanges['editor.minimap']).toBe('true')
    expect(useSettingsStore.getState().pendingChanges['editor.lineNumbers']).toBe('false')
    expect(useSettingsStore.getState().pendingChanges['editor.autocompleteBackticks']).toBe('true')
  })
})
