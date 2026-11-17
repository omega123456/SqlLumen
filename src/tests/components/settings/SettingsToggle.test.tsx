import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsToggle } from '../../../components/settings/SettingsToggle'

describe('SettingsToggle', () => {
  it('renders label and switch', () => {
    render(<SettingsToggle label="Auto-save" checked={false} onChange={() => {}} />)

    expect(screen.getByText('Auto-save')).toBeInTheDocument()
    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  it('renders description when provided', () => {
    render(
      <SettingsToggle
        label="Auto-save"
        description="Save files automatically"
        checked={false}
        onChange={() => {}}
      />
    )

    expect(screen.getByText('Save files automatically')).toBeInTheDocument()
  })
})
