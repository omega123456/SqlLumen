import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsToggle } from '../../../components/settings/SettingsToggle'

describe('SettingsToggle', () => {
  it('renders label and checkbox', () => {
    render(<SettingsToggle label="Auto-save" checked={false} onChange={() => {}} />)

    expect(screen.getByText('Auto-save')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
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

  it('calls onChange with new checked state when clicked', async () => {
    const user = userEvent.setup()
    const onChangeSpy = vi.fn()
    render(<SettingsToggle label="Auto-save" checked={false} onChange={onChangeSpy} />)

    await user.click(screen.getByRole('checkbox'))
    expect(onChangeSpy).toHaveBeenCalledWith(true)
  })

  it('applies data-testid to container', () => {
    render(
      <SettingsToggle label="Test" checked={true} onChange={() => {}} data-testid="my-toggle" />
    )

    expect(screen.getByTestId('my-toggle')).toBeInTheDocument()
  })

  it('checkbox is disabled when disabled prop is true', () => {
    render(<SettingsToggle label="Disabled toggle" checked={false} onChange={() => {}} disabled />)

    expect(screen.getByRole('checkbox')).toBeDisabled()
  })
})
