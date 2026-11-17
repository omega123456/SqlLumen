import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SettingsDropdownField,
  SettingsFieldLabel,
} from '../../../components/settings/SettingsField'

const OPTIONS = [
  { value: 'one', label: 'One' },
  { value: 'two', label: 'Two' },
]

describe('SettingsFieldLabel', () => {
  it('renders a label tied to its input', () => {
    render(
      <>
        <SettingsFieldLabel htmlFor="field-input">Field</SettingsFieldLabel>
        <input id="field-input" />
      </>
    )

    expect(screen.getByLabelText('Field')).toHaveAttribute('id', 'field-input')
  })
})

describe('SettingsDropdownField', () => {
  it('names the dropdown and its label after the field name', () => {
    render(
      <SettingsDropdownField
        name="sample"
        label="Sample"
        options={OPTIONS}
        value="one"
        onChange={vi.fn()}
      />
    )

    const dropdown = screen.getByRole('combobox', { name: 'Sample' })
    expect(dropdown).toHaveAttribute('id', 'settings-sample')
    expect(dropdown).toHaveTextContent('One')
    expect(screen.getByText('Sample')).toHaveAttribute('id', 'sample-label')
  })

  it('reports the chosen value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SettingsDropdownField
        name="sample"
        label="Sample"
        options={OPTIONS}
        value="one"
        onChange={onChange}
      />
    )

    await user.click(screen.getByRole('combobox', { name: 'Sample' }))
    await user.click(await screen.findByRole('option', { name: 'Two' }))

    expect(onChange).toHaveBeenCalledWith('two')
  })
})
